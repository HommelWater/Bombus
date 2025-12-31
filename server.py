from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from functions import auth, channels, users, voice, files, networking, database, push, search
import inspect
import logging
import aiofiles, os, asyncio, time, math
from collections import defaultdict
from pydantic import BaseModel

MAX_REQUESTS_PER_MINUTE = 50

ema_tracking = defaultdict(lambda: (0, 0.0))
state_lock = asyncio.Lock()

def safe_call(func, data_dict):
    sig = inspect.signature(func)
    expected_params = list(sig.parameters.keys())
    
    filtered_data = {}
    mismatched_params = []
    
    for k, v in data_dict.items():
        if k in expected_params:
            filtered_data[k] = v
        else:
            mismatched_params.append(k)
    
    if mismatched_params:
        logging.warning(
            f"Function {func.__name__} received unexpected parameters: {mismatched_params}. "
            f"Expected: {expected_params}. Provided: {list(data_dict.keys())}"
        )
    print (filtered_data)
    user_id = filtered_data["sender_user_id"]
    with state_lock:
        last, rate = ema_tracking[user_id]
        if last != 0:
            interval = max((time.time() - last) / 60.0, 1e-10)
            alpha = math.exp(-interval)
            r_inst = 1.0 / interval
            rate = (1 - alpha) * r_inst + alpha * rate
            rate = max(rate, 1.0 / interval)

        ema_tracking[user_id] = (time.time(), rate)
    if rate <= MAX_REQUESTS_PER_MINUTE:
        return func(**filtered_data)
    else:
        print(f"User with ID {user_id} hit the rate limit.", flush=True)

request_map = {
    "authenticate":     auth.authenticate,
    "get_invite":       auth.get_invite,

    "get_channels":     channels.get_channels,
    "create_channel":   channels.create_channel,
    "delete_channel":   channels.delete_channel,
    "get_posts":        channels.get_posts,
    "send_post":        channels.send_post,

    "get_users":        users.get_users,
    "get_self":         users.get_self,
    "set_username":     users.set_username,
    "update_user":      users.update_user,
    "update_activity":  users.update_activity,
    "set_pfp":          users.set_pfp,
    
    "vc_get_users":     voice.get_users,
    "vc_connect":       voice.connect,
    "vc_offer":         voice.offer,
    "vc_answer":        voice.answer,
    "vc_candidate":     voice.candidate,
    "vc_disconnect":    voice.disconnect,
      
    "push_subscribe":   push.subscribe,
    "push_unsubscribe": push.unsubscribe,

    "new_file":         files.new_file,
    "file_upload":      files.file_upload
}

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await database.init_database()
    yield

app = FastAPI(lifespan=lifespan)

# Search Engine API
class SearchRequest(BaseModel):
    query:str
    session_token:str

class RecentIndexRequest(BaseModel):
    session_token:str

class IndexRequest(BaseModel):
    image_base64:str
    session_token:str
    url:str
    title:str

@app.post("/search")
async def s(request_data: SearchRequest):
    return await search.search(request_data.session_token, request_data.query)

@app.post("/search/recent")
async def s(request_data: RecentIndexRequest):
    return await search.recently_indexed(request_data.session_token)

@app.post("/index")
async def s(request_data: IndexRequest):
    return await search.index_webpage(request_data.session_token, request_data.url, request_data.title, request_data.image_base64)


# File API
@app.get("/files/{hash}")
async def download(hash: str):
    path = f"./interface/files/{hash}"
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")

    file_metadata = await database.get_file_metadata(hash=hash)
    if not file_metadata:
        raise HTTPException(404, "File not found in DB.")

    filename = file_metadata["name"]
    ext = filename.split('.')[-1].lower() if '.' in filename else ''
    
    # Determine if it's an image (use FileResponse)
    image_exts = {'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'}
    is_image = ext in image_exts

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"',
        "Cache-Control": "public, max-age=31536000, immutable",
    }

    if is_image:
        # FileResponse for images: optimal caching & browser rendering
        return FileResponse(
            path,
            media_type=f"image/{ext}" if ext != 'jpg' else "image/jpeg",
            headers=headers
        )
    else:
        # StreamingResponse for large/non-image files: memory efficient
        CHUNK = 8 * 1024 * 1024
        async def iterfile():
            async with aiofiles.open(path, "rb") as f:
                while chunk := await f.read(CHUNK):
                    yield chunk
        return StreamingResponse(
            iterfile(),
            media_type="application/octet-stream",
            headers=headers
        )

# Navigation
@app.get("/")
async def read_root():
    return FileResponse("./interface/app/index.html")

@app.get("/auth")
async def read_auth():
    return FileResponse("./interface/auth/index.html")

@app.get("/search")
async def read_search():
    return FileResponse("./interface/search/index.html")


# Websocket API
@app.websocket("/ws")
async def endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        user_id = None
        while not user_id:
            data = await websocket.receive_json()
            if data.get("type", "") != "authenticate":
                continue
            if not data.get("data"):
                continue
            data["data"]["websocket"] = websocket
            user_id = await safe_call(auth.authenticate, data["data"])
    except WebSocketDisconnect as e:
        print(e)
        return
    
    async with networking.state_lock:
        networking.connections[user_id].append(websocket)


    await channels.get_channels(user_id)
    await users.get_users(user_id)
    await users.get_self(user_id)
    await voice.get_users(user_id)
    await push.vapid_public_key(user_id)
    await auth.ice_info(user_id)
    await networking.send(user_id, {"type":"session_login", "data":{"notification":"Successfully logged in."}})

    try:
        while True:
            data = await websocket.receive_json()
            if not data["type"] == "file_upload": print(data, flush=True)

            message_type = data.get("type")
            if not message_type or message_type not in request_map:
                continue
            
            handler_func = request_map.get(message_type)
            if not handler_func:
                continue
            
            handler_data = {
                "sender_user_id": user_id,
                **(data.get("data", {})) 
            }

            await safe_call(handler_func, handler_data)
    except WebSocketDisconnect:
        async with networking.state_lock:
            networking.connections[user_id].remove(websocket)
        await voice.disconnect(user_id)
    except KeyError as e:
        logging.error(f"Missing expected key in WebSocket data: {e}")
    except Exception as e:
        logging.error(f"Unexpected error in WebSocket handler: {e}")

app.mount("/", StaticFiles(directory="./interface"), name="static")

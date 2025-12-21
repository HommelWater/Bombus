from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from functions import auth, channels, users, voice, files, networking, database, push
import inspect
import logging
import aiofiles, os

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
    return func(**filtered_data)

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

@app.get("/files/{hash}")
async def download(hash: str):
    path = f"./interface/files/{hash}"
    if not os.path.isfile(path):
        raise HTTPException(404, "File not found")

    file_metadata = database.get_file_metadata(hash=hash)

    stat_result = os.stat(path)
    headers = {
        "Content-Disposition": f'attachment; filename="{file_metadata["filename"]}"',
        "Content-Length": str(stat_result.st_size),
    }

    CHUNK = 2 * 1024 * 1024
    async def iterfile():
        async with aiofiles.open(path, "rb") as f:
            while chunk := await f.read(CHUNK):
                yield chunk
    return StreamingResponse(iterfile(), media_type="application/octet-stream", headers=headers)

@app.get("/")
async def read_root():
    return FileResponse("./interface/app/index.html")

@app.get("/auth")
async def read_root():
    return FileResponse("./interface/auth/index.html")

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

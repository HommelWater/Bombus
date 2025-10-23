from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import database as data
import time
import base64
from pathlib import Path
from PIL import Image
import io

from auth import router as auth_router
from persistent import router as peristent_router
from persistent import broadcast

data.init_database()
app = FastAPI()
app.include_router(auth_router, prefix="/auth")
app.include_router(peristent_router, prefix="/persistent")

class ChannelInfo(BaseModel):
    session_key: str
    name: str

class ChangeProfilePictureInfo(BaseModel):
    session_key: str
    file: str
    extension: str

class LoadMessagesInfo(BaseModel):
    session_key: str
    from_message: int
    channel_id: int

class SearchInfo(BaseModel):
    session_key: str
    channel_id: int
    query: str

class PostContextInfo(BaseModel):
    session_key: str
    post_id: int

@app.get("/")
async def read_root():
    return FileResponse("./interface/main/index.html")

@app.get("/login")
async def read_root():
    return FileResponse("./interface/login/index.html")

@app.post("/channel")
async def channel(info: ChannelInfo):
    session = data.get_session(info.session_key)
    if session is None:
        return {"status":"failure", "result":"Could not find session."}
    
    if info.name is not None:
        idx = data.create_channel(info.name)
        if idx is None:
            return {"status":"failure", "result":"Could not create channel."}
    
    await broadcast({"channels":data.get_channels()})
    return {"status":"success", "result":idx}

@app.post("/change_profile_picture")
async def change_profile_picture(info: ChangeProfilePictureInfo):
    session = data.get_session(info.session_key)
    if session is None:
        return {"status":"failure", "result":"Could not find session."}
    
    user_id = session["user_id"]
    file_data = base64.b64decode(info.file)
    
    try:
        image = Image.open(io.BytesIO(file_data))
        if image.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', image.size, (255, 255, 255))
            if image.mode == 'P':
                image = image.convert('RGBA')
            background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
            image = background   
        output_buffer = io.BytesIO()
        image.save(output_buffer, format='WEBP', quality=85) 
        webp_data = output_buffer.getvalue()

        file_path = Path(f"./interface/images/users/{user_id}.webp")
        file_path.parent.mkdir(exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(webp_data)
        
        return {"status": "success", "message": "Profile picture updated."}
    
    except Exception as e:
        return {"status": "failure", "result": f"Error processing image: {str(e)}"}

@app.post("/load_messages_old")
async def load_messages_old(info: LoadMessagesInfo):
    session = data.get_session(info.session_key)
    if session is None:
        return {"status":"failure", "result":"Could not find session."}
    posts = data.get_posts_before(info.channel_id, info.from_message, 50)
    if posts is None:
        return {"status":"failure", "result":"Could not get posts."}
    return {"status":"success", "result":posts}

@app.post("/load_messages_new")
async def load_messages_new(info: LoadMessagesInfo):
    session = data.get_session(info.session_key)
    if session is None:
        return {"status":"failure", "result":"Could not find session."}
    posts = data.get_posts_after(info.channel_id, info.from_message, 50)
    if posts is None:
        return {"status":"failure", "result":"Could not get posts."}
    return {"status":"success", "result":posts}

@app.post("/search")
async def search(info: SearchInfo):
    session = data.get_session(info.session_key)
    if session is None:
        return {"status":"failure", "result":"Could not find session."}
    posts = data.search_posts(info.channel_id, info.query)
    if posts is None:
        return {"status":"failure", "result":"Could not get posts."}
    return {"status":"success", "result":posts}

@app.post("/post_context")
async def search(info: PostContextInfo):
    session = data.get_session(info.session_key)
    if session is None:
        return {"status":"failure", "result":"Could not find session."}
    channel_id, posts = data.get_neighboring_posts(info.post_id)
    if posts is None:
        return {"status":"failure", "result":"Could not get posts."}
    return {"status":"success", "result":{"posts":posts, "channel_id":channel_id}}


app.mount("/", StaticFiles(directory="./interface"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
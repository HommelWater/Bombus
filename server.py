from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import database as database
import pyotp
import base64
from pathlib import Path
from PIL import Image
import io
import os
from auth import router as auth_router
from persistent import router as peristent_router
from persistent import broadcast

database.init_database()
app = FastAPI()
app.include_router(auth_router, prefix="/auth")
app.include_router(peristent_router, prefix="/persistent")

class RequestInfo(BaseModel):
    session_key: str
    type:str
    data:dict

@app.get("/")
async def read_root():
    return FileResponse("./interface/main/index.html")

@app.get("/login")
async def read_root():
    return FileResponse("./interface/login/index.html")

@app.post("/request")
async def request(info:RequestInfo):
    session = database.get_session(info.session_key)
    if session is None:
        return {"status":"failure", "result":"Could not find session."}
    return await type_function_map[info.type](session, info.data)

async def invite(session, data):
    invite_code = pyotp.random_hex()[:12]
    idx = database.create_invite_code(invite_code, session["user_id"], data["uses"])
    if idx is None:
        return {"status":"failure", "result":"Could not create invite code."}
    return {"status":"success", "result":invite_code}

async def channel(session, data):
    if data["name"] is None:
        return {"status":"failure", "result":"No channel name given."}
    idx = database.create_channel(data["name"])
    if idx is None:
        return {"status":"failure", "result":"Could not create channel."}
    await broadcast({"channels":database.get_channels()})
    return {"status":"success", "result":idx}

async def profile_picture(session, data):
    user_id = session["user_id"]
    file_data = base64.b64decode(data["file"])
    
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

async def load_old_posts(session, data):
    posts = database.get_posts_before(data["channel_id"], data["from_post"], 50)
    if posts is None:
        return {"status":"failure", "result":"Could not get posts."}
    return {"status":"success", "result":posts}

async def load_new_posts(session, data):
    posts = database.get_posts_after(data["channel_id"], data["from_post"], 50)
    if posts is None:
        return {"status":"failure", "result":"Could not get posts."}
    return {"status":"success", "result":posts}

async def search(session, data):
    posts = database.search_posts(data["channel_id"], data["query"])
    if posts is None:
        return {"status":"failure", "result":"Could not get posts."}
    return {"status":"success", "result":posts}

async def context(session, data):
    channel_id, posts = database.get_neighboring_posts(data["post_id"])
    if posts is None:
        return {"status":"failure", "result":"Could not get posts."}
    return {"status":"success", "result":posts}

async def ban(session, data):
    user = database.get_user_by_id(session["user_id"])
    if user is None or not user["admin"]:
        return {"status":"failure", "result":"You do not have permission to ban users."}
    banned = database.toggle_ban(data["user_id"])
    if banned is None:
        return {"status":"failure", "result":"Could not ban or unban user."}
    if banned:
        return {"status":"success", "result":"User successfully banned."}
    else: return {"status":"success", "result":"User successfully unbanned."}

async def restrict(session, data):
    user = database.get_user_by_id(session["user_id"])
    if user is None or not user["admin"]:
        return {"status":"failure", "result":"You do not have permission to restrict users."}
    restricted = database.toggle_restrict(data["user_id"])
    if restricted is None:
        return {"status":"failure", "result":"Could not restrict or unrestrict user."}
    if restricted:
        return {"status":"success", "result":"User successfully restricted."}
    else: return {"status":"success", "result":"User successfully unrestricted."}

async def admin(session, data):
    user = database.get_user_by_id(session["user_id"])
    if user is None or not user["admin"]:
        return {"status":"failure", "result":"You do not have permission to make users administrator."}
    admin = database.toggle_admin(data["user_id"])
    if admin is None:
        return {"status":"failure", "result":"Could not give or take admin privileges."}
    if admin:
        return {"status":"success", "result":"User successfully made administrator."}
    else: return {"status":"success", "result":"User successfully removed administrator privileges."}

async def delete_profile_picture(session, data):
    user = database.get_user_by_id(session["user_id"])
    if user is None or (not user["admin"] or user.id != data["user_id"]):
        return {"status":"failure", "result":"You do not have permission to delete this profile picture."}
    file_path = f"/interface/images/users/{data["user_id"]}.webp"
    if os.path.exists(file_path):
        os.remove(file_path)
        return {"status":"success", "result":"Deleted user profile picture."}
    return {"status":"failure", "result":"Could not delete user profile picture."}

async def rename(session, data):
    user = database.get_user_by_id(session["user_id"])
    if user is None or (not user["admin"] or user.id != data["user_id"]):
        return {"status":"failure", "result":"You do not have permission to rename this user."}
    newname = database.rename_user(data["user_id"])
    if newname is None:
        return {"status":"failure", "result":"Could not rename user."}
    return {"status":"success", "result":f"Renamed user to '{newname}'."}

app.mount("/", StaticFiles(directory="./interface"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

type_function_map = {
    "invite": invite,
    "profile_picture": profile_picture,
    "channel": channel,
    "load_old_posts": load_old_posts,
    "load_new_posts": load_new_posts,
    "search": search,
    "context": context,
    "ban": ban,
    "restrict": restrict,
    "admin": admin,
    "delete_profile_picture":delete_profile_picture,
    "rename":rename
}
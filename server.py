from fastapi import FastAPI, WebSocket, HTTPException, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from database import DataManager
import pyotp
import uuid
import time

app = FastAPI()
data = DataManager("data.db")

class LoginInfo(BaseModel):
    username: str
    totp_code: str

class SignupInfo(BaseModel):
    username: str
    invite_code: str

class SignupVerifyInfo(BaseModel):
    username: str
    totp_code: str

class InviteInfo(BaseModel):
    session_key: str
    uses: int

class ChannelInfo(BaseModel):
    session_key: str
    name: str

@app.get("/")
async def read_root():
    return FileResponse("./interface/index.html")

@app.post("/login")
async def login(info: LoginInfo):
    user = data.get_user(info.username)
    if user is None or not pyotp.TOTP(user["totp_secret"]).verify(info.totp_code):
        return {"status":"failure", "result":"Incorrect verification code or username."}
    
    if not user["verified"]:
        data.verify_user(user["id"])

    session_key = str(uuid.uuid4())
    idx = data.create_session(session_key, user["id"])
    if idx is None:
        return {"status":"failure", "result":"Could not create new session."}
    
    return {"status":"success", "result":session_key}

@app.post("/signup")
async def signup(info: SignupInfo):
    if info.username == "admin":
        totp_secret = pyotp.random_base32()
        user = data.create_user(info.username, totp_secret, 1)
        if user is None:
            return {"status":"failure", "result":"Could not create user."}
        return {"status":"success", "result":totp_secret}

    invite = data.get_invite_code(info.invite_code)
    if invite is None:
        return {"status":"failure", "result":"Could not find invite code."}
    
    if invite["uses"] <= 0:
        return {"status":"failure", "result":"Invalid code expired."}
    
    totp_secret = pyotp.random_base32()
    user = data.create_user(info.username, totp_secret, invite["inviter_id"])
    if user is None:
        return {"status":"failure", "result":"Could not create user."}
    
    return {"status":"success", "result":totp_secret}

@app.post("/invite")
async def invite(info: InviteInfo):
    session = data.get_session(info.session_key)
    if session is None:
        return {"status":"failure", "result":"Could not find session."}
        
    invite_code = pyotp.random_hex()[:12]
    idx = data.create_invite_code(invite_code, session["user_id"], info.uses)
    if idx is None:
        return {"status":"failure", "result":"Could not create invite code."}
    
    return {"status":"success", "result":invite_code}

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

connections = []
@app.websocket("/ws")
async def endpoint(websocket: WebSocket):
    t = await setupConnection(websocket)
    if t is None:
        return
    session, user = t
    try:
        while True:
            message = await websocket.receive_json()
            message["username"] = user["username"]
            message["created_at"] = int(time.time())
            data.add_post(user["id"], message["channel"], message["msg"])
            await broadcast(message)
    except WebSocketDisconnect:
        connections.remove(websocket)    

async def setupConnection(websocket: WebSocket):
    await websocket.accept()
    
    auth_message = await websocket.receive_json()
    session_key = auth_message.get("session")
    if not session_key:
        await websocket.send_json({"status": "No session key provided."})
        await websocket.close()
        return
    
    session = data.get_session(session_key)
    if not session:
        await websocket.send_json({"status": "Invalid session."})
        await websocket.close()
        return
    
    user = data.get_user_by_id(session["user_id"])
    if not user:
        await websocket.send_json({"status": "Invalid user."})
        await websocket.close()
        return
    connections.append(websocket)
    await websocket.send_json({"channels":data.get_channels()})
    return session, user

async def broadcast(json):
    for c in connections:
        await c.send_json(json)

app.mount("/", StaticFiles(directory="./interface"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
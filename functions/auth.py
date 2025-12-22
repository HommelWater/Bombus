from . import database
from .networking import send
import pyotp
import uuid
import hmac, hashlib, base64, time, os
from dotenv import load_dotenv

load_dotenv()
TURN_SECRET = os.getenv("TURN_SECRET")
TURN_HOST   = os.getenv("TURN_HOST")

async def signup(websocket, username, key):
    if username == "admin":
        totp_secret = pyotp.random_base32()
        user = await database.create_user(username, totp_secret, 1)
        if not user:
            await websocket.send_json({"type":"failure", "data":{"notification":"Admin account already exists."}})
            return
        await database.update_user_status(user["id"], admin=True)
        await websocket.send_json({"type":"signup", "data":{"totp_secret":totp_secret}})
        return
        
    invite = await database.get_invite_code(key)
    if invite is None:
        await websocket.send_json({"type":"failure", "data":{"notification":"Could not find invite code."}})
        return
    
    if invite["uses"] <= 0:
        await websocket.send_json({"type":"failure", "data":{"notification":"Invalid code expired."}})
        return
    
    totp_secret = pyotp.random_base32()
    user = await database.create_user(username, totp_secret, invite["inviter_id"])
    if user is None:
        user = await database.get_user(username, safe=False)
        totp_secret = user["totp_secret"]
        if user is None or user["verified"]:
            await websocket.send_json({"type":"failure", "data":{"notification":"Could not create user."}})
            return
    
    await websocket.send_json({"type":"signup", "data":{"totp_secret":totp_secret}})
    return

async def login(websocket, username, key):
    user = await database.get_user(username, safe=False)
    if user is None or not pyotp.TOTP(user["totp_secret"]).verify(key):
        await websocket.send_json({"type":"failure", "data":{"notification":"Incorrect verification code or username."}})
        return 
    
    if not user["verified"]:
        await database.verify_user(user["id"])

    if user["banned"]:
        await websocket.send_json({"type":"failure", "data":{"notification":"User is banned from this server."}})
        return
    
    session_key = str(uuid.uuid4())
    idx = await database.create_session(session_key, user["id"])
    if idx is None:
        await websocket.send_json({"type":"failure", "data":{"notification":"Could not create new session."}})
        return
    await websocket.send_json({"type":"login", "data":{"session_key":session_key}})

async def authenticate_session(websocket, key):
    session = await database.get_session(key)
    if not session:
        await websocket.send_json({"type":"session_expired", "data":{"notification":"Session not found."}})
        return
    return session["user_id"]

async def authenticate(websocket, key, username=""):
    if username == "":
        return await authenticate_session(websocket, key)
    if len(key) == 6:
        return await login(websocket, username, key)
    else:
        return await signup(websocket, username, key)

async def get_invite(sender_user_id):
    invite_code = pyotp.random_hex()[:12]
    idx = await database.create_invite_code(invite_code, sender_user_id, 1)  # TODO: properly add multiple use keys.
    if idx is None:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not create invite code."}})
        return
    await send(sender_user_id, {"type":"invite", "data":{"invite_code":invite_code}})

async def ice_info(sender_user_id):
    ttl  = 24*3600
    user = f"{int(time.time()) + ttl }:webrtc"
    pwd  = base64.b64encode(
             hmac.new(TURN_SECRET.encode(), user.encode(), hashlib.sha1).digest()
           ).decode()
    await send(sender_user_id, {"type":"ice_info", "data":{"servers":[
            {"urls": f"stun:{TURN_HOST}:3478"},
            {
                "urls": [f"turn:{TURN_HOST}:3478", f"turns:{TURN_HOST}:5349"],
                "username": user,
                "credential": pwd
            }]}})

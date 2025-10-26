import database as database
from fastapi import APIRouter
from pydantic import BaseModel
import pyotp
import uuid

router = APIRouter(tags=["authentication"])

class LoginInfo(BaseModel):
    username: str
    totp_code: str

class SignupInfo(BaseModel):
    username: str
    invite_code: str

@router.post("/login")
async def login(info: LoginInfo):
    user = database.get_user(info.username)
    if user is None or not pyotp.TOTP(user["totp_secret"]).verify(info.totp_code):
        return {"status":"failure", "result":"Incorrect verification code or username."}
    
    if not user["verified"]:
        database.verify_user(user["id"])

    session_key = str(uuid.uuid4())
    idx = database.create_session(session_key, user["id"])
    if idx is None:
        return {"status":"failure", "result":"Could not create new session."}
    
    return {"status":"success", "result":session_key}

@router.post("/signup")
async def signup(info: SignupInfo):
    if info.username == "admin":
        totp_secret = pyotp.random_base32()
        user = database.create_user(info.username, totp_secret, 1)
        if user is None:
            return {"status":"failure", "result":"Could not create user."}
        admin = database.toggle_admin(user["id"])
        if admin is None or not admin:
            return {"status":"failure", "result":"Could not set user to admin."}
        return {"status":"success", "result":totp_secret}

    invite = database.get_invite_code(info.invite_code)
    if invite is None:
        return {"status":"failure", "result":"Could not find invite code."}
    
    if invite["uses"] <= 0:
        return {"status":"failure", "result":"Invalid code expired."}
    
    totp_secret = pyotp.random_base32()
    user = database.create_user(info.username, totp_secret, invite["inviter_id"])
    if user is None:
        return {"status":"failure", "result":"Could not create user."}
    
    return {"status":"success", "result":totp_secret}
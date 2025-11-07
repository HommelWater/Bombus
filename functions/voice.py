from . import database
from .networking import broadcast, send
from collections import defaultdict
import asyncio
#Should I be sending individual user connects/disconnects or update the entire per channel list? 
#Passing along the whole list makes client-server sync more robust in cases where they are desynced (should never happen but might anyways).
#Slightly faster on the client and server to pass along single disconnects though.

async def verify_access(user_id, admin_only=False):
    user = await database.get_user(user_id)
    if user and ((user["banned"] or user["restricted"] or admin_only) and not user["admin"]):
        await send(user_id, {"type":"failure", "data":{"notification":"Invalid user or user permissions."}})
        return True
    return False

voice_channel_users = defaultdict(set)
state_lock = asyncio.Lock()

async def get_users(sender_user_id):
    if await verify_access(sender_user_id): return
    async with state_lock:
        l_vc_u = {i: list(j) for i, j in voice_channel_users.items()}
        await send(sender_user_id,{"type":"vc_channel_users", "data": {"channel_users":l_vc_u}})

async def connect(sender_user_id, channel_id):
    if await verify_access(sender_user_id): return
    async with state_lock:
        voice_channel_users[channel_id].add(sender_user_id)
    await broadcast({"type":"connect", "data": {"channel_id":channel_id, "user_id":sender_user_id}})

async def disconnect(sender_user_id):
    channel_id = None
    for k, v in voice_channel_users.items():
        if sender_user_id in v:
            channel_id = k
    
    if channel_id is None:
        print(f"Disconnect for user {sender_user_id} while not in a channel.")
        return
    
    async with state_lock:
        voice_channel_users[channel_id].remove(sender_user_id)
    await broadcast({"type":"disconnect", "data": {"channel_id":channel_id, "user_id":sender_user_id}})

#These are almost exactly the same. Should I make it just call relay in 'server' directly? At least this is fairly clear.
async def relay(sender_user_id, target_user_id, type, data):
    if sender_user_id == target_user_id: return
    if await verify_access(sender_user_id): return
    await send(target_user_id, {"type":type, "data": {"sender_user_id":sender_user_id, "data":data}})

async def offer(sender_user_id, target_user_id, offer):
    await relay(sender_user_id, target_user_id, "offer", offer)

async def answer(sender_user_id, target_user_id, answer):
    await relay(sender_user_id, target_user_id, "answer", answer)

async def candidate(sender_user_id, target_user_id, candidate):
    await relay(sender_user_id, target_user_id, "candidate", candidate)
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import database
import time
import asyncio

router = APIRouter(tags=["persistent"])
state_lock = asyncio.Lock()

connections = {}
@router.websocket("/ws")
async def endpoint(websocket: WebSocket):
    await websocket.accept()
    session = None
    user = None
    try:
        while True:
            data = await websocket.receive_json()
            print(data)
            async with state_lock:
                session, user = await base_packet_types[data["type"]](websocket, data["data"], session, user)
    except WebSocketDisconnect:
        connections.pop(user["id"])
        await onActivity(websocket, {"user_id":user["id"], "active":False}, session, user)

async def onHello(websocket: WebSocket, data, session, user):
    session_key = data.get("session")
    if not session_key:
        await websocket.send_json({"type":"error", "data":{"reset":True, "error_message":"No session key provided."}})
        await websocket.close()
        return None, None
    
    session = database.get_session(session_key)
    if not session:
        await websocket.send_json({"type":"error", "data":{"reset":True, "error_message":"Invalid session."}})
        await websocket.close()
        return None, None
    
    user = database.get_user_by_id(session["user_id"])
    if not user:
        await websocket.send_json({"type":"error", "data":{"reset":True, "error_message":"Invalid user."}})
        await websocket.close()
        return None, None
    
    connections[user["id"]] = websocket
    channels = database.get_channels()
    for i in range(len(channels)):
        channel_id = str(channels[i]["id"])
        channels[i]["connected_users"] = list(channel_peers.get(channel_id, ()))
    recent_posts = database.recent_posts_per_channel(since_id=data["latest_post_id"])
    if recent_posts is None:
        recent_posts = []
    users = database.get_users()
    for u in users:
        u["active"] = u["id"] in list(connections.keys())
    await websocket.send_json({"type":"hello", "data":{"user_id": session["user_id"], "users":users, "channels":channels, "posts":recent_posts}})
    await broadcast({"type":"activity", "data":{"user_id":user["id"], "active":True}})
    return session, user

async def onActivity(websocket: WebSocket, data, session, user):
    data["user_id"] = user["id"]
    await broadcast({"type":"activity", "data":data})
    return session, user

async def onMessage(websocket: WebSocket, data, session, user):
    if (user["restricted"] or user["banned"]) and not user["admin"]:
        return session, user 
    post_id = database.add_post(user["id"], data["channel"], data["content"])
    data = database.get_post(post_id)
    await broadcast({"type":"message", "data":data})
    return session, user

async def broadcast(json):
    print(json)
    for k, c in connections.items():
        await c.send_json(json)

channel_peers = {}
async def vc_offer(websocket: WebSocket, data, session, user):
    if (user["banned"] or user["restricted"]) and not user["admin"]:
        return session, user
    user_id = user["id"]
    offer = data["offer"]
    target_id = data["id"]
    if user_id == target_id: return session, user    
    await connections[target_id].send_json({"type":"offer", "data": {"offer":offer, "user_id":user_id}})
    return session, user

async def vc_answer(websocket: WebSocket, data, session, user):
    if (user["banned"] or user["restricted"]) and not user["admin"]:
        return session, user
    target_user_id = data["id"]
    user_id = user["id"]
    answer = data["answer"]
    await connections[target_user_id].send_json({"type":"answer", "data": {"answer":answer, "user_id":user_id}})
    return session, user

async def vc_candidate(websocket: WebSocket, data, session, user):
    if (user["banned"] or user["restricted"]) and not user["admin"]:
        return session, user
    user_id = user["id"]
    candidate = data["candidate"]
    target_id = data["id"]
    if target_id == user_id: return session, user
    await connections[target_id].send_json({"type": "candidate", "data": {"candidate": candidate, "user_id": user_id}})
    return session, user

async def vc_connect(websocket: WebSocket, data, session, user):
    if (user["banned"] or user["restricted"]) and not user["admin"]:
        return session, user
    channel_id = data.get("channel_id")
    user_id = user["id"]
    if channel_peers.get(channel_id) is None:
        channel_peers[channel_id] = set()
    
    channel_peers[channel_id].add(user_id)
    for peer in channel_peers[channel_id]:
        await connections[peer].send_json({"type":"connect", "data": {"users":list(channel_peers[channel_id]), "current_user":peer}})
    
    await broadcast({"type":"vc_users", "data": {"channel_id":channel_id, "users":list(channel_peers[channel_id])}})
    return session, user

async def vc_disconnect(websocket: WebSocket, data, session, user):
    user_id = user["id"]
    channel_id = None
    for k, v in channel_peers.items():
        if user_id in v:
            channel_id = str(k)
    if channel_id is None:
        print(f"Disconnect for user {user_id} while not in a channel.")
        return session, user
    for peer in channel_peers[channel_id]:
        await connections[peer].send_json({"type":"disconnect", "data": {"user_id":user_id}})
    channel_peers[channel_id].remove(user_id)
    await broadcast({"type":"vc_users", "data": {"channel_id":channel_id, "users":list(channel_peers[channel_id])}})
    return session, user

base_packet_types = {
    "hello":onHello,
    "message": onMessage,
    "activity": onActivity,
    "vc_offer": vc_offer,
    "vc_answer":vc_answer,
    "vc_candidate": vc_candidate,
    "vc_connect": vc_connect,
    "vc_disconnect": vc_disconnect
}
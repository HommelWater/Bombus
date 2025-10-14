from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import database
import time

router = APIRouter(tags=["persistent"])

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
            session, user = await base_packet_types[data["type"]](websocket, data["data"], session, user)
    except WebSocketDisconnect:
        connections.pop(user["id"]) 

async def onHello(websocket: WebSocket, data, session, user):
    session_key = data.get("session")
    if not session_key:
        await websocket.send_json({"status": "No session key provided."})
        await websocket.close()
        return None, None
    
    session = database.get_session(session_key)
    if not session:
        await websocket.send_json({"status": "Invalid session."})
        await websocket.close()
        return None, None
    
    user = database.get_user_by_id(session["user_id"])
    if not user:
        await websocket.send_json({"status": "Invalid user."})
        await websocket.close()
        return None, None
    
    connections[user["id"]] = websocket
    channels = database.get_channels()
    for i in range(len(channels)):
        channels[i]["connected_users"] = list(channel_peers.get(i, ()))
    await websocket.send_json({"channels":channels})
    return session, user

async def onMessage(websocket: WebSocket, data, session, user):
    data["username"] = user["username"]
    data["created_at"] = int(time.time())
    database.add_post(user["id"], data["channel"], data["msg"])
    await broadcast(data)
    return session, user

async def broadcast(json):
    for k, c in connections.items():
        await c.send_json(json)

channel_peers = {}
async def vc_offer(websocket: WebSocket, data, session, user):
    user_id = user["id"]
    offer = data["offer"]
    target_id = data["id"]
    if user_id == target_id: return session, user    
    await connections[target_id].send_json({"type":"offer", "offer":offer, "user_id":user_id})
    return session, user

async def vc_answer(websocket: WebSocket, data, session, user):
    target_user_id = data["id"]
    user_id = user["id"]
    answer = data["answer"]
    await connections[target_user_id].send_json({"type":"answer", "answer":answer, "user_id":user_id})
    return session, user

async def vc_candidate(websocket: WebSocket, data, session, user):
    user_id = user["id"]
    candidate = data["candidate"]
    target_id = data["id"]
    if target_id == user_id: return session, user
    await connections[target_id].send_json({"type": "candidate", "candidate": candidate, "user_id": user_id})
    return session, user

async def vc_connect(websocket: WebSocket, data, session, user):
    channel_id = data.get("channel_id")
    user_id = user["id"]
    if channel_peers.get(channel_id) is None:
        channel_peers[channel_id] = set()
    
    channel_peers[channel_id].add(user_id)
    for peer in channel_peers[channel_id]:
        await connections[peer].send_json({"type":"connect", "users":list(channel_peers[channel_id]), "current_user":peer})
    
    await broadcast({"type":"channel_users", "channel_id":channel_id, "users":list(channel_peers[channel_id])})
    return session, user

async def vc_disconnect(websocket: WebSocket, data, session, user):
    channel_id = data.get("channel_id")
    user_id = user["id"]

    for peer in channel_peers[channel_id]:
        if user_id == peer: continue
        await connections[peer].send_json({"type":"disconnect", "user":[user_id]})
    channel_peers[channel_id].remove(user_id)
    await broadcast({"type":"channel_users", "channel_id":channel_id, "users":list(channel_peers[channel_id])})
    return session, user



base_packet_types = {
    "hello":onHello,
    "message": onMessage,
    "vc_offer": vc_offer,
    "vc_answer":vc_answer,
    "vc_candidate": vc_candidate,
    "vc_connect": vc_connect,
    "vc_disconnect": vc_disconnect
}
import asyncio
connections = {}
state_lock = asyncio.Lock()

async def broadcast(json):
    async with state_lock:
        for c in list(connections.values()):
            await c.send_json(json)

async def send(user_id, json):
    async with state_lock:
        socket = connections.get(user_id, None)
        if not socket:
            print(f"User ID {user_id} is not connected! Could not broadcast to user.")
        await socket.send_json(json)
    await broadcast({"type":"activity", "data":{"user_id":user_id}})

"""
async def broadcast(json, user_ids=None):
    if not user_ids:
        for k, c in connections.items():
            await c.send_json(json)
    else:
        for user_id in user_ids:
            connection = connections.get(user_id, None)
            if connection:
                connection.send_json(json)
            else:
                print(f"User ID {user_id} is not connected! Could not broadcast to user.")
"""
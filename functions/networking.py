import asyncio
from collections import defaultdict
from pywebpush import webpush, WebPushException
from . import database
import json
from urllib.parse import urlparse
from dotenv import load_dotenv
import os
import base64

connections = defaultdict(list)
state_lock = asyncio.Lock()

def convert_vapid_public_key_for_browser(vapid_pub_der_b64: str) -> str:
    der_bytes = base64.b64decode(vapid_pub_der_b64)
    raw_key_bytes = der_bytes[-65:]
    urlsafe_b64 = base64.urlsafe_b64encode(raw_key_bytes).decode("utf-8").rstrip("=")
    return urlsafe_b64

load_dotenv()
VAPID_PUBLIC_KEY = convert_vapid_public_key_for_browser(os.getenv("VAPID_PUBLIC_KEY"))
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_SUB = os.getenv("VAPID_SUB")

async def broadcast(json):
    async with state_lock:
        for c in list(connections.values()):
            for v in c:
                await v.send_json(json)

async def send(user_id, json):
    async with state_lock:
        sockets = connections.get(user_id, None)
        if not sockets:
            print(f"User ID {user_id} is not connected! Could not broadcast to user.")
        for s in sockets:
            await s.send_json(json)
    await broadcast({"type":"activity", "data":{"user_id":user_id}})

async def push_notify(sender_user_id, message):
    subscriptions = await database.get_push_subscriptions()
    await send(1, {"a":subscriptions})
    sender = await database.get_user(sender_user_id)
    if not subscriptions: return
    for row in subscriptions:
        sub_json_str = row.get("subscription_json")
        user_id = row.get("user_id")
        await send(1, {"user_id":user_id})
        if not sub_json_str or user_id:
            continue
        async with state_lock:
            if len(connections[user_id]) == 0: continue  # Only push when no connections for this user are active.
        await send(1, {"connections":connections})
        sub = json.loads(sub_json_str)
        if not sub.get("endpoint"):
            continue

        parsed = urlparse(sub["endpoint"])
        aud = f"{parsed.scheme}://{parsed.netloc}"
        data = {"message":message, "username":sender.get("username"), "user_id":sender_user_id}
        try:
            webpush(
                subscription_info=sub,
                data=json.dumps(data),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims={"sub": VAPID_SUB, "aud": aud}
            )        
        except WebPushException as ex:
            if ex.response is not None and int(ex.response.status_code) in [404, 410]:
                if sub and sub["endpoint"]:
                    await database.remove_push_subscription(user_id, sub["endpoint"])
            print(f"Push failed: {repr(ex)}")

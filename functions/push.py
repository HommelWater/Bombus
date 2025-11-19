import os
from .networking import send
from . import database
from dotenv import load_dotenv
import base64

load_dotenv()

def convert_vapid_public_key_for_browser(vapid_pub_der_b64: str) -> str:
    der_bytes = base64.b64decode(vapid_pub_der_b64)
    raw_key_bytes = der_bytes[-65:]
    urlsafe_b64 = base64.urlsafe_b64encode(raw_key_bytes).decode("utf-8").rstrip("=")
    return urlsafe_b64

VAPID_PUBLIC_KEY = convert_vapid_public_key_for_browser(os.getenv("VAPID_PUBLIC_KEY"))

async def subscribe(sender_user_id, subscription):
    success = await database.add_push_subscription(sender_user_id, subscription)
    if not success:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Couldn't add subscription."}})
        return
    await send(sender_user_id, {"type":"success", "data":{"notification":"Successfully subscribed to push notifications."}})
        
async def vapid_public_key(sender_user_id):
    await send(sender_user_id, {"type":"vapid_public_key", "data":{"key":VAPID_PUBLIC_KEY}})

async def unsubscribe(sender_user_id, subscription):
    success = False
    if subscription and subscription["endpoint"]:
        success = await database.remove_push_subscription(sender_user_id, subscription)
    if not success:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Couldn't remove subscription."}})
        return
    await send(sender_user_id, {"type":"success", "data":{"notification":"Successfully unsubscribed to push notifications."}})

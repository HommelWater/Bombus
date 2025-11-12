import os
from pywebpush import webpush, WebPushException
from .networking import send, broadcast
from . import database
from dotenv import load_dotenv
import base64
import json

load_dotenv()

def convert_vapid_public_key_for_browser(vapid_pub_der_b64: str) -> str:
    der_bytes = base64.b64decode(vapid_pub_der_b64)
    raw_key_bytes = der_bytes[-65:]
    urlsafe_b64 = base64.urlsafe_b64encode(raw_key_bytes).decode("utf-8").rstrip("=")
    return urlsafe_b64

VAPID_PUBLIC_KEY = convert_vapid_public_key_for_browser(os.getenv("VAPID_PUBLIC_KEY"))
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_SUB = os.getenv("VAPID_SUB")

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

async def send_notifications(user_ids, message):
    subscriptions = await database.get_push_subscriptions(user_ids)
    subscriptions = [json.loads(sub) for sub in subscriptions]
    if not subscriptions: return
    for sub in subscriptions:
        try:
            webpush(
                subscription_info=sub,
                data=message,
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_public_key=VAPID_PUBLIC_KEY,
                vapid_claims={"sub": VAPID_SUB}
            )
        except WebPushException as ex:
            if ex.response and ex.response.status_code in [404, 410]:
                if sub and sub["endpoint"]:
                    await database.remove_push_subscription(sub["endpoint"])
            print(f"Push failed: {repr(ex)}")

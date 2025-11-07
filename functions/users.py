from . import database
from .networking import broadcast, send

import io
import base64
from PIL import Image
from pathlib import Path

async def get_users(sender_user_id):
    users = await database.get_users()
    if not users:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not send users."}})
        return
    await send(sender_user_id, {"type":"users", "data":{"users":users}})

async def get_self(sender_user_id):
    await send(sender_user_id, {"type":"self", "data":{"user_id":sender_user_id}})

async def update_user(sender_user_id, target_user_id, banned=None, restricted=None, admin=None):
    if banned is None and restricted is None and admin is None:
        return
    
    sender_user = await database.get_user(sender_user_id)
    if not sender_user or not sender_user["admin"]:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"You do not have permission for this action."}}) 
        return
    
    success = await database.update_user_status(target_user_id, banned, restricted, admin)
    if not success:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not update user values."}}) 
        return
    
    users = await database.get_users()
    if not users:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not send users."}}) 
        return 
    
    await broadcast({"type":"users", "data":{"users":users}})

async def set_username(sender_user_id, target_user_id, username):
    if sender_user_id is not target_user_id:
        sender_user = await database.get_user(sender_user_id)
        if not sender_user or not sender_user["admin"]:
            await send(sender_user_id, {"type":"failure", "data":{"notification":"You do not have permission to change this user's username."}})
    success = await database.update_user_username(target_user_id, username)
    if not success:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not change this user's username."}})
        return
    await send(sender_user_id, {"type":"success", "data":{"notification":"Changed username successfully."}})
    users = await database.get_users()
    if not users:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not send users."}}) 
        return 
    await broadcast({"type":"users", "data":{"users":users}})

#TODO: is this safe? can the base64 stuff be abused?
async def set_pfp(sender_user_id, target_user_id, file_base64):
    if sender_user_id is not target_user_id:
        sender_user = await database.get_user(sender_user_id)
        if not sender_user or not sender_user["admin"]:
            await send(sender_user_id, {"type":"failure", "data":{"notification":"You do not have permission to change this users profile picture."}}) 
    file = base64.b64decode(file_base64)
    
    try:
        image = Image.open(io.BytesIO(file))
        if image.mode in ('RGBA', 'LA', 'P'):
            background = Image.new('RGB', image.size, (255, 255, 255))
            if image.mode == 'P':
                image = image.convert('RGBA')
            background.paste(image, mask=image.split()[-1] if image.mode == 'RGBA' else None)
            image = background   
        output_buffer = io.BytesIO()
        image.save(output_buffer, format='WEBP', quality=85) 
        webp_data = output_buffer.getvalue()

        file_path = Path(f"./interface/images/users/{target_user_id}.webp")
        file_path.parent.mkdir(exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(webp_data)
        await send(sender_user_id, {"type": "success", "data":{"notification": "Updated profile picture."}})
    
    except Exception as e:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not change profile picture."}})

async def update_activity(sender_user_id):
    await broadcast({"type":"activity", "data":{"user_id":sender_user_id}})
from . import database
from .networking import broadcast, send, push_notify

async def get_channels(sender_user_id):#TODO: add user_id based channel return
    channels = await database.get_channels()
    if not channels:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not send channels."}})
        return
    
    await send(sender_user_id, {"type":"channels", "data":{"channels":channels}})

async def create_channel(sender_user_id, name):
    user = await database.get_user(sender_user_id)
    if not user or not user["admin"]:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"You do not have permission to create a new channel."}})
        return

    channel_id = await database.create_channel(name)
    if not channel_id:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not create new channel."}})
        return
    
    channels = await database.get_channels()
    if not channels:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not send updated channels."}})
        return
    
    await broadcast({"type":"channels", "data":{"channels":channels}})

async def delete_channel(sender_user_id, name): #  Maybe switch this so that it just hides it and doesn't permanently delete it lol :')
    user = await database.get_user(sender_user_id)
    if not user or not user["admin"]:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"You do not have permission to create a new channel."}})
        return

    success = await database.delete_channel(name)
    if not success:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not delete channel."}})
        return
    
    channels = await database.get_channels()
    if not channels:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not send updated channels."}})
        return
    
    await broadcast({"type":"channels", "data":{"channels":channels}})

async def get_posts(sender_user_id, channel_id=None, from_id=None, direction=None, query=None):
    #TODO: check if user has permissions for this channel, filter out channels only where the user has permission for.
    posts = await database.get_posts(channel_id, from_id, direction, query)
    if posts is None:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not send posts."}})
        return
    
    await send(sender_user_id, {"type":"posts", "data":{"posts":posts}})

async def send_post(sender_user_id, channel_id, content):
    post_id = await database.add_post(sender_user_id, channel_id, content)
    if not post_id:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could add posts."}})
        return
    
    post = await database.get_post(post_id)
    if not post:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not retrieve created post."}})
        return
    await broadcast({"type":"posts", "data":{"posts":[post]}})
    print("teststsetaroan")
    await push_notify(sender_user_id, content)

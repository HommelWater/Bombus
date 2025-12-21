from .networking import broadcast, send
from . import database, channels
from pathlib import Path
import hashlib
import base64

FILES_DIR = Path("./interface/files")
FILES_DIR.mkdir(exist_ok=True)
CHUNK_SIZE = 1024 * 1024 * 4 #THIS HAS TO BE THE SAME ON THE CLIENT & SERVER!

# Builds a merkle tree of hashes, equal to that of the client.
def hash_file(path):
    levels = []
    with open(path, "rb") as f:
        while True:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break
            levels.append(hashlib.sha256(chunk).digest())
    
    if not levels:
        levels.append(hashlib.sha256(b"").digest())
    
    while len(levels) > 1:
        next_level = []

        for i in range(0, len(levels), 2):
            left = levels[i]
            right = levels[i + 1] if i + 1 < len(levels) else left

            combined = left + right
            next_level.append(hashlib.sha256(combined).digest())

        levels = next_level

    return levels[0].hex()

async def file_upload(sender_user_id, hash, offset, chunk):
    user_dir = FILES_DIR / str(sender_user_id)
    user_dir.mkdir(exist_ok=True)

    file_path = user_dir / hash

    if not file_path.exists():
        file_path.touch()

    chunk_bytes = base64.b64decode(chunk)
    with open(file_path, "r+b" if file_path.exists() else "wb") as f:
        f.seek(offset)
        f.write(chunk_bytes)
    
    file = await database.get_file_metadata(hash=hash)
    if not file:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"File does not exist."}})
        return
    
    if offset + len(chunk_bytes) >= file["size"]:
        await channels.send_post(sender_user_id, file["channel"], "{file:hash} " + f"{file["name"]}")
        await send(sender_user_id, {"type":"file_upload_complete", "data":{"notification":"File uploaded."}})

        actual_hash = hash_file(file_path)
        if actual_hash != hash:
            await send(sender_user_id, {"type":"failure", "data":{"notification":"File hash does not match with user sent hash."}})

async def new_file(sender_user_id, channel_id, hash, name, size):
    user_dir = FILES_DIR / str(sender_user_id)
    user_dir.mkdir(exist_ok=True)

    file_path = user_dir / hash

    if file_path.exists():
        await send(sender_user_id, {"type":"failure", "data":{"notification":"File already exists."}})
        return
    file_path.touch()
    await database.store_file_metadata(name, channel_id, size, hash)
    await send(sender_user_id, {"type":"start_upload", "data":{"name":name, "size":size, "hash":hash}})

async def get_files(sender_user_id):
    files = await database.get_all_files()
    if not files:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not find files."}})
        return
    await send(sender_user_id, {"type":"files", "data":{"files":files}})

async def get_file(sender_user_id, hash):
    file = await database.get_file_metadata(hash=hash)
    if not file:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not find file."}})
        return
    await send(sender_user_id, {"type":"files", "data":{"files":[file]}})
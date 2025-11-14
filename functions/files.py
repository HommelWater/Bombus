from .networking import broadcast, send
from . import database
from pathlib import Path
import hashlib
import base64

FILES_DIR = Path("./interface/files")
FILES_DIR.mkdir(exist_ok=True)

def compute_file_hash(path):
    sha256 = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256.update(chunk)
    return sha256.hexdigest()

async def file_upload(sender_user_id, hash, offset, chunk):
    user_dir = FILES_DIR / str(sender_user_id)
    user_dir.mkdir(exist_ok=True)

    file_path = user_dir / hash

    if not file_path.exists():
        file_path.touch()

    chunk_bytes = base64.decode(chunk)
    with open(file_path, "r+b" if file_path.exists() else "wb") as f:
        f.seek(offset)
        f.write(chunk_bytes)
    
    file = await database.get_file_metadata(hash)
    if not file:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"File does not exist."}})
        return
    
    if offset + len(chunk_bytes) >= file["size"]:
        actual_hash = compute_file_hash(file_path)
        if actual_hash != hash:
            pass #what do i do? Fix the file? or delete it and just have the user try again?

async def new_file(sender_user_id, hash, name, size):
    user_dir = FILES_DIR / str(sender_user_id)
    user_dir.mkdir(exist_ok=True)

    file_path = user_dir / hash

    if file_path.exists():
        await send(sender_user_id, {"type":"failure", "data":{"notification":"File already exists."}})
        return
    file_path.touch()
    await database.store_file_metadata(name, size, hash)
    await send(sender_user_id, {"type":"start_upload", "data":{"name":name, "size":size, "hash":hash}})

async def get_files(sender_user_id):
    files = await database.get_all_files()
    if not files:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not find files."}})
        return
    await send(sender_user_id, {"type":"files", "data":{"files":files}})

async def get_file(sender_user_id, hash):
    file = await database.get_file_metadata(hash)
    if not file:
        await send(sender_user_id, {"type":"failure", "data":{"notification":"Could not find file."}})
        return
    await send(sender_user_id, {"type":"files", "data":{"files":[file]}})
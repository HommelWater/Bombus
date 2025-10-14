from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import database as data
import time

from auth import router as auth_router
from persistent import router as peristent_router
from persistent import broadcast

data.init_database()
app = FastAPI()
app.include_router(auth_router, prefix="/auth")
app.include_router(peristent_router, prefix="/persistent")

class ChannelInfo(BaseModel):
    session_key: str
    name: str

@app.get("/")
async def read_root():
    return FileResponse("./interface/index.html")

@app.post("/channel")
async def channel(info: ChannelInfo):
    session = data.get_session(info.session_key)
    if session is None:
        return {"status":"failure", "result":"Could not find session."}
    
    if info.name is not None:
        idx = data.create_channel(info.name)
        if idx is None:
            return {"status":"failure", "result":"Could not create channel."}
    
    await broadcast({"channels":data.get_channels()})
    return {"status":"success", "result":idx}


app.mount("/", StaticFiles(directory="./interface"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
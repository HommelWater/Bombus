from fastapi import FastAPI, WebSocket
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from database import DataManager

app = FastAPI()
data = DataManager("data.db")

@app.get("/")
async def read_root():
    return FileResponse("./interface/index.html")

@app.websocket("/ws")
async def endpoint(websocket: WebSocket):
    await websocket.accept()
    while True:
        data = await websocket.receive_text()
        await websocket.send_text(data)

app.mount("/", StaticFiles(directory="./interface"), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
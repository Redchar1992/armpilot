"""FastAPI server: streams sim state over WebSocket at ~30 Hz, accepts commands.

Run: uvicorn armpilot.server:app --port 8000
"""

import asyncio
import json
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .agent import run_command
from .demo import run_demo
from .sim import SimEnv

FPS = 30

env = SimEnv(realtime=True)
clients: set = set()
cmd_lock = threading.Lock()  # one demo/command at a time
_loop = None


@asynccontextmanager
async def lifespan(app):
    global _loop
    _loop = asyncio.get_running_loop()
    threading.Thread(target=_sim_loop, daemon=True).start()
    task = asyncio.create_task(_broadcaster())
    yield
    task.cancel()


app = FastAPI(lifespan=lifespan)


def _sim_loop():
    while True:
        env.idle_step()


async def _send_safe(ws, text):
    # A stalled client (e.g. a throttled background tab) must not block the
    # broadcast loop: bounded send, drop on timeout/error.
    try:
        await asyncio.wait_for(ws.send_text(text), timeout=1.0)
        return None
    except Exception:
        return ws


async def _broadcast(text):
    if not clients:
        return
    dead = await asyncio.gather(*[_send_safe(ws, text) for ws in list(clients)])
    for ws in dead:
        if ws is not None:
            clients.discard(ws)
            try:
                await ws.close()
            except Exception:
                pass


async def _broadcaster():
    while True:
        await asyncio.sleep(1 / FPS)
        if clients:
            await _broadcast(json.dumps(env.get_frame()))


def emit(kind, **payload):
    """Thread-safe event broadcast from worker threads."""
    text = json.dumps({"type": kind, **payload})
    _loop.call_soon_threadsafe(lambda: asyncio.ensure_future(_broadcast(text)))


def _submit(job, name):
    if not cmd_lock.acquire(blocking=False):
        emit("error", message="busy: another command is still running")
        return

    def wrapper():
        try:
            job()
        except Exception as e:  # surface worker crashes to the UI
            emit("error", message=f"{name} crashed: {e}")
        finally:
            cmd_lock.release()

    threading.Thread(target=wrapper, daemon=True).start()


def _demo_job():
    emit("status", message="running scripted demo: red block -> blue plate")
    ok = run_demo(env, emit=lambda m: emit("status", message=m))
    emit("done", success=ok, message="demo finished" if ok else "demo failed")


def _reset_job():
    env.reset()
    emit("status", message="scene reset")


def _command_job(text):
    emit("status", message=f"agent processing: {text}")
    result = run_command(env, text, emit=lambda m: emit("agent_event", message=m))
    emit("done", success=result["success"],
         message=f"[{result['planner']}] " +
                 ("goal verified ✓" if result["success"] else "goal NOT achieved"))


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    # send scene_init before joining the broadcast set, so no frame precedes it
    await websocket.send_text(json.dumps(env.scene_description()))
    clients.add(websocket)
    try:
        while True:
            msg = json.loads(await websocket.receive_text())
            kind = msg.get("type")
            if kind == "demo":
                _submit(_demo_job, "demo")
            elif kind == "reset":
                _submit(_reset_job, "reset")
            elif kind == "command":
                text = str(msg.get("text", "")).strip()
                if text:
                    _submit(lambda: _command_job(text), "command")
            else:
                emit("error", message=f"unknown message type {kind!r}")
    except WebSocketDisconnect:
        clients.discard(websocket)

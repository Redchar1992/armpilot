"""M1 data-pipeline check: connect to the WS, trigger the demo, verify
scene_init + a steady frame stream + demo success event."""

import asyncio
import json
import sys

import websockets


async def main():
    async with websockets.connect("ws://localhost:8000/ws", max_size=64 * 1024 * 1024) as ws:
        init = json.loads(await ws.recv())
        assert init["type"] == "scene_init", init["type"]
        meshes = [g for g in init["geoms"] if g["type"] == "mesh"]
        print(f"scene_init: {len(init['geoms'])} geoms ({len(meshes)} meshes), "
              f"{sum(len(g.get('verts', [])) for g in init['geoms']) // 3} mesh verts total")

        await ws.send(json.dumps({"type": "demo"}))

        frames = 0
        statuses = []
        done = None
        t_first = t_last = None
        while done is None:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
            if msg["type"] == "frame":
                frames += 1
                t_first = t_first if t_first is not None else msg["t"]
                t_last = msg["t"]
                assert len(msg["poses"]) == len(init["geoms"])
            elif msg["type"] == "status":
                statuses.append(msg["message"])
            elif msg["type"] == "done":
                done = msg

        print(f"frames received: {frames} (sim time {t_first} -> {t_last})")
        print("demo steps:", " | ".join(statuses))
        print("done:", done)
        assert frames > 100, "frame stream too sparse"
        assert done["success"], "demo did not succeed"
        print("M1 WS PIPELINE PASS")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        print(f"FAIL: {e}")
        sys.exit(1)

"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Frame, GeomDef } from "../components/Viewer";

const Viewer = dynamic(() => import("../components/Viewer"), { ssr: false });

const WS_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws";

type LogLine = { cls: "info" | "ok" | "err"; text: string };

export default function Page() {
  const [geoms, setGeoms] = useState<GeomDef[] | null>(null);
  const [connected, setConnected] = useState(false);
  const [holding, setHolding] = useState<string | null>(null);
  const [simTime, setSimTime] = useState(0);
  const [log, setLog] = useState<LogLine[]>([]);
  const [command, setCommand] = useState("");
  const frameRef = useRef<Frame | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  const append = useCallback((cls: LogLine["cls"], text: string) => {
    setLog((l) => [...l.slice(-199), { cls, text }]);
  }, []);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setConnected(true);
        append("info", "connected to sim server");
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === "scene_init") setGeoms(msg.geoms);
        else if (msg.type === "frame") {
          frameRef.current = msg;
          setHolding((h) => (h === msg.holding ? h : msg.holding));
          // throttle React re-renders to ~4/s; 3D updates run via frameRef
          setSimTime((t) => (Math.abs(t - msg.t) > 0.25 ? msg.t : t));
        } else if (msg.type === "status" || msg.type === "agent_event")
          append("info", msg.message);
        else if (msg.type === "done") append(msg.success ? "ok" : "err", msg.message);
        else if (msg.type === "error") append("err", msg.message);
      };
    }
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      wsRef.current?.close();
    };
  }, [append]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  const send = (obj: unknown) => wsRef.current?.send(JSON.stringify(obj));

  return (
    <div className="app">
      <div className="topbar">
        <span className="dot" style={{ background: connected ? "#3fb950" : "#f85149" }} />
        <h1>ArmPilot — language-commanded robot arm</h1>
      </div>
      <div className="main">
        <div className="viewport">
          {geoms ? (
            <Viewer geoms={geoms} frameRef={frameRef} />
          ) : (
            <p style={{ padding: 20 }}>waiting for scene…</p>
          )}
        </div>
        <div className="panel">
          <section>
            <h2>Status</h2>
            <div className="statusRow">
              <span>sim time</span>
              <span>{simTime.toFixed(1)}s</span>
            </div>
            <div className="statusRow">
              <span>holding</span>
              <span>{holding ?? "—"}</span>
            </div>
          </section>
          <section>
            <h2>Command</h2>
            <form
              className="commandForm"
              onSubmit={(e) => {
                e.preventDefault();
                const text = command.trim();
                if (!text) return;
                append("info", `> ${text}`);
                send({ type: "command", text });
                setCommand("");
              }}
            >
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="e.g. 把红色方块放进蓝色盘子"
                disabled={!connected}
              />
              <button type="submit" disabled={!connected}>
                Send
              </button>
            </form>
          </section>
          <section>
            <h2>Actions</h2>
            <div className="buttons">
              <button onClick={() => send({ type: "demo" })} disabled={!connected}>
                Run demo
              </button>
              <button className="secondary" onClick={() => send({ type: "reset" })} disabled={!connected}>
                Reset
              </button>
            </div>
          </section>
          <div className="log" ref={logRef}>
            {log.map((l, i) => (
              <div key={i} className={l.cls}>
                {l.text}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

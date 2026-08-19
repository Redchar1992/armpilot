"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createRuntime } from "@/lib/createRuntime";
import { EXAMPLE_COMMANDS } from "@/lib/planner";
import type {
  AgentPhase,
  Frame,
  GeomDef,
  RuntimeMessage,
} from "@/lib/sceneTypes";

const Viewer = dynamic(() => import("@/components/Viewer"), {
  ssr: false,
  loading: () => <div className="viewerLoading">Preparing the 3D workcell…</div>,
});

type RunState = "idle" | "running" | "success" | "error";
type TraceLine = {
  id: number;
  kind: "system" | "tool" | "success" | "error" | "command";
  text: string;
  tool?: string;
  timestamp: string;
};

const PHASE_LABELS: Record<AgentPhase, string> = {
  idle: "Ready",
  planning: "Planning",
  perceiving: "Reading scene",
  moving: "Executing motion",
  grasping: "Manipulating object",
  verifying: "Verifying goal",
  completed: "Goal verified",
  error: "Needs attention",
};

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 .8a11.4 11.4 0 0 0-3.6 22.2c.57.1.78-.25.78-.55v-2.2c-3.18.7-3.85-1.35-3.85-1.35-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.75 1.18 1.75 1.18 1.02 1.75 2.68 1.24 3.33.95.1-.74.4-1.24.73-1.53-2.54-.29-5.21-1.27-5.21-5.63 0-1.25.44-2.26 1.18-3.06-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.14 1.17a10.9 10.9 0 0 1 5.72 0c2.18-1.48 3.14-1.17 3.14-1.17.62 1.57.23 2.73.11 3.02.74.8 1.18 1.81 1.18 3.06 0 4.37-2.68 5.33-5.23 5.62.41.36.78 1.05.78 2.12v3.15c0 .3.2.66.79.55A11.4 11.4 0 0 0 12 .8Z"
      />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4.9 7.1A8 8 0 1 1 4 13M4.9 7.1V3.8m0 3.3h3.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatHolding(value: string | null) {
  return value ? value.replace("_", " ") : "gripper open";
}

export default function Page() {
  const runtime = useMemo(createRuntime, []);
  const frameRef = useRef<Frame | null>(null);
  const traceListRef = useRef<HTMLDivElement | null>(null);
  const traceId = useRef(0);
  const [geoms, setGeoms] = useState<GeomDef[] | null>(null);
  const [connected, setConnected] = useState(false);
  const [holding, setHolding] = useState<string | null>(null);
  const [simTime, setSimTime] = useState(0);
  const [command, setCommand] = useState(EXAMPLE_COMMANDS[0]);
  const [activeGoal, setActiveGoal] = useState("Waiting for an instruction");
  const [phase, setPhase] = useState<AgentPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [runState, setRunState] = useState<RunState>("idle");
  const [lastDuration, setLastDuration] = useState<number | null>(null);
  const [trace, setTrace] = useState<TraceLine[]>([]);

  const appendTrace = useCallback(
    (kind: TraceLine["kind"], text: string, tool?: string) => {
      const timestamp = new Date().toLocaleTimeString([], {
        minute: "2-digit",
        second: "2-digit",
      });
      setTrace((lines) => [
        ...lines.slice(-39),
        { id: ++traceId.current, kind, text, tool, timestamp },
      ]);
    },
    [],
  );

  useEffect(() => {
    runtime.connect((message: RuntimeMessage) => {
      if (message.type === "scene_init") {
        setGeoms(message.geoms);
        return;
      }
      if (message.type === "frame") {
        frameRef.current = message;
        setHolding((current) => (current === message.holding ? current : message.holding));
        setSimTime((current) =>
          Math.abs(current - message.t) > 0.24 ? message.t : current,
        );
        return;
      }
      if (message.type === "connection") {
        setConnected(message.connected);
        appendTrace("system", message.message);
        return;
      }
      if (message.type === "status" || message.type === "agent_event") {
        if (message.phase) setPhase(message.phase);
        if (message.progress !== undefined) setProgress(message.progress);
        if (message.phase && message.phase !== "idle") setRunState("running");
        appendTrace(message.type === "agent_event" ? "tool" : "system", message.message, message.tool);
        return;
      }
      if (message.type === "done") {
        setPhase(message.success ? "completed" : "error");
        setProgress((current) => (message.success ? 100 : current));
        setRunState(message.success ? "success" : "error");
        setLastDuration(message.durationMs ?? null);
        appendTrace(message.success ? "success" : "error", message.message);
        return;
      }
      if (message.type === "error") {
        setPhase("error");
        setRunState("error");
        appendTrace("error", message.message);
      }
    });
    return () => runtime.dispose();
  }, [appendTrace, runtime]);

  useEffect(() => {
    const list = traceListRef.current;
    list?.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [trace]);

  const runCommand = () => {
    const text = command.trim();
    if (!text || !connected || runState === "running") return;
    setActiveGoal(text);
    setPhase("planning");
    setProgress(2);
    setRunState("running");
    setLastDuration(null);
    setTrace([]);
    appendTrace("command", text);
    runtime.send({ type: "command", text });
  };

  const reset = () => {
    runtime.send({ type: "reset" });
    setHolding(null);
    setPhase("idle");
    setProgress(0);
    setRunState("idle");
    setActiveGoal("Waiting for an instruction");
    setLastDuration(null);
    setTrace([]);
  };

  const runtimeEyebrow = runtime.mode === "browser" ? "STATIC-SAFE RUNTIME" : "LIVE PHYSICS";
  const canRun = connected && Boolean(command.trim()) && runState !== "running";

  return (
    <main className="appShell">
      <header className="appHeader">
        <div className="brandGroup">
          <div className="brandMark" aria-hidden="true">
            <span />
            <i />
          </div>
          <div>
            <div className="brandLine">
              <h1>ArmPilot</h1>
              <span>LAB 01</span>
            </div>
            <p>Language-grounded manipulation, visible end to end.</p>
          </div>
        </div>

        <div className="headerActions">
          <div className="runtimeBadge" aria-live="polite">
            <span className={connected ? "online" : "offline"} />
            <div>
              <strong>{runtime.label}</strong>
              <small>{runtime.description}</small>
            </div>
          </div>
          <button className="iconButton" type="button" onClick={reset} aria-label="Reset workcell">
            <ResetIcon />
          </button>
          <a
            className="githubButton"
            href="https://github.com/Redchar1992/armpilot"
            target="_blank"
            rel="noreferrer"
            aria-label="View source on GitHub"
          >
            <GithubIcon />
            <span>Source</span>
          </a>
        </div>
      </header>

      <section className="proofStrip" aria-label="Project evidence">
        <span>20 / 20 TASK EVAL</span>
        <i />
        <span>30 HZ STATE STREAM</span>
        <i />
        <span>ZH + EN COMMANDS</span>
        <i />
        <span>VERIFIED GOAL PREDICATES</span>
      </section>

      <div className="workspace">
        <section className="stageCard" aria-label="Robot workcell visualization">
          <div className="stageHeader">
            <div>
              <span className="eyebrow">{runtimeEyebrow}</span>
              <h2>Franka tabletop workcell</h2>
            </div>
            <div className="stageTelemetry">
              <span><b>30</b> FPS</span>
              <span><b>{simTime.toFixed(1)}</b> SIM S</span>
            </div>
          </div>

          <div className="viewerFrame">
            {geoms ? (
              <Viewer geoms={geoms} frameRef={frameRef} />
            ) : (
              <div className="viewerLoading">Waiting for scene initialization…</div>
            )}
            <div className="viewportChrome topLeft">
              <span className={connected ? "pulseDot" : "pulseDot offline"} />
              {connected ? "RUNTIME READY" : "CONNECTING"}
            </div>
            <div className="viewportChrome bottomLeft">
              Drag to orbit · scroll to zoom
            </div>
            <div className="axisLegend" aria-hidden="true">
              <span className="axisX">X</span>
              <span className="axisY">Y</span>
              <span className="axisZ">Z</span>
            </div>
          </div>

          <div className="stageFooter">
            <div className="architecturePath" aria-label="Execution architecture">
              <span>Language</span><i>→</i><span>Tool plan</span><i>→</i>
              <span>IK + trajectory</span><i>→</i><span>Workcell</span><i>→</i><span>Verify</span>
            </div>
            <p>
              {runtime.mode === "browser"
                ? "This hosted demo uses deterministic planning and client-side kinematics. The repository includes the full MuJoCo + LLM runtime."
                : "The LLM selects discrete tools; classical control owns every continuous trajectory."}
            </p>
          </div>
        </section>

        <aside className="controlDeck" aria-label="ArmPilot control deck">
          <section className="composerCard">
            <div className="sectionHeading">
              <div>
                <span className="sectionIndex">01</span>
                <h2>Describe the task</h2>
              </div>
              <span className="languagePill">中文 / EN</span>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                runCommand();
              }}
            >
              <label className="srOnly" htmlFor="command">Robot instruction</label>
              <textarea
                id="command"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="e.g. 把红色方块放进蓝色盘子"
                maxLength={180}
                rows={3}
                disabled={!connected}
              />
              <div className="examples" aria-label="Example instructions">
                {EXAMPLE_COMMANDS.map((example, index) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setCommand(example)}
                    disabled={runState === "running"}
                  >
                    <span>0{index + 1}</span>
                    {example}
                  </button>
                ))}
              </div>
              <button className="runButton" type="submit" disabled={!canRun}>
                <span>{runState === "running" ? "Executing task" : "Plan & execute"}</span>
                <i aria-hidden="true">{runState === "running" ? "···" : "↗"}</i>
              </button>
            </form>
          </section>

          <section className="runCard" aria-live="polite">
            <div className="sectionHeading compact">
              <div>
                <span className="sectionIndex">02</span>
                <h2>Run state</h2>
              </div>
              <span className={`runState ${runState}`}>{PHASE_LABELS[phase]}</span>
            </div>
            <p className="activeGoal">{activeGoal}</p>
            <div
              className="progressTrack"
              role="progressbar"
              aria-label="Task progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
            >
              <span style={{ width: `${progress}%` }} />
            </div>
            <div className="runMetrics">
              <div><span>Progress</span><strong>{Math.round(progress)}%</strong></div>
              <div><span>Gripper</span><strong>{formatHolding(holding)}</strong></div>
              <div><span>Last run</span><strong>{lastDuration ? `${(lastDuration / 1000).toFixed(1)}s` : "—"}</strong></div>
            </div>
          </section>

          <section className="traceCard">
            <div className="sectionHeading compact">
              <div>
                <span className="sectionIndex">03</span>
                <h2>Execution trace</h2>
              </div>
              <span className="traceCount">{trace.length} EVENTS</span>
            </div>
            <div className="traceList" role="log" aria-live="polite" ref={traceListRef}>
              {trace.length ? (
                trace.map((line) => (
                  <div className={`traceLine ${line.kind}`} key={line.id}>
                    <span className="traceMarker" />
                    <div>
                      <div className="traceMeta">
                        <time>{line.timestamp}</time>
                        {line.tool && <code>{line.tool}</code>}
                      </div>
                      <p>{line.text}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="emptyTrace">
                  <span>⌁</span>
                  <p>Tool calls and verification evidence will appear here.</p>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

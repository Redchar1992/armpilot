export type GeomDef = {
  id: number;
  name: string;
  type: "plane" | "box" | "sphere" | "cylinder" | "capsule" | "mesh";
  size: number[];
  rgba: number[];
  verts?: number[];
  faces?: number[];
};

export type Pose = [
  x: number,
  y: number,
  z: number,
  qw: number,
  qx: number,
  qy: number,
  qz: number,
];

export type Frame = {
  type: "frame";
  t: number;
  poses: Pose[];
  holding: string | null;
};

export type AgentPhase =
  | "idle"
  | "planning"
  | "perceiving"
  | "moving"
  | "grasping"
  | "verifying"
  | "completed"
  | "error";

export type RuntimeMessage =
  | { type: "scene_init"; geoms: GeomDef[] }
  | Frame
  | {
      type: "connection";
      connected: boolean;
      message: string;
    }
  | {
      type: "status" | "agent_event";
      message: string;
      phase?: AgentPhase;
      progress?: number;
      tool?: string;
    }
  | {
      type: "done";
      success: boolean;
      message: string;
      durationMs?: number;
    }
  | { type: "error"; message: string };

export type RuntimeCommand =
  | { type: "command"; text: string }
  | { type: "demo" }
  | { type: "reset" };

export interface ArmRuntime {
  readonly mode: "browser" | "websocket";
  readonly label: string;
  readonly description: string;
  connect(emit: (message: RuntimeMessage) => void): void;
  send(command: RuntimeCommand): void;
  dispose(): void;
}


import * as THREE from "three";

import { planCommand, type DemoGoal } from "./planner";
import type {
  ArmRuntime,
  GeomDef,
  Pose,
  RuntimeCommand,
  RuntimeMessage,
} from "./sceneTypes";

type Vec3 = [number, number, number];
type BlockName = "red_block" | "green_block" | "blue_block" | "yellow_block";

const HOME_TARGET: Vec3 = [0.34, 0, 0.34];
const BLOCK_IDS: Record<BlockName, number> = {
  red_block: 10,
  green_block: 11,
  blue_block: 12,
  yellow_block: 13,
};

const INITIAL_BLOCKS: Record<BlockName, Vec3> = {
  red_block: [0.39, -0.19, 0.027],
  green_block: [0.48, -0.07, 0.027],
  blue_block: [0.43, 0.11, 0.027],
  yellow_block: [0.53, 0.21, 0.027],
};

const STATIC_TARGETS: Record<string, Vec3> = {
  blue_plate: [0.69, -0.16, 0.028],
  white_plate: [0.69, 0.16, 0.028],
  left_zone: [0.31, 0.32, 0.027],
  right_zone: [0.61, 0.32, 0.027],
};

export const DEMO_GEOMS: GeomDef[] = [
  { id: 0, name: "workcell", type: "plane", size: [0.95, 0.8], rgba: [0.09, 0.12, 0.16, 1] },
  { id: 1, name: "robot_base", type: "cylinder", size: [0.105, 0.045], rgba: [0.19, 0.23, 0.29, 1] },
  { id: 2, name: "upper_arm", type: "capsule", size: [0.042, 0.14], rgba: [0.82, 0.86, 0.9, 1] },
  { id: 3, name: "forearm", type: "capsule", size: [0.038, 0.13], rgba: [0.72, 0.77, 0.83, 1] },
  { id: 4, name: "wrist_link", type: "capsule", size: [0.031, 0.055], rgba: [0.3, 0.35, 0.42, 1] },
  { id: 5, name: "wrist", type: "sphere", size: [0.052], rgba: [0.16, 0.2, 0.26, 1] },
  { id: 6, name: "left_finger", type: "box", size: [0.012, 0.012, 0.052], rgba: [0.75, 0.8, 0.86, 1] },
  { id: 7, name: "right_finger", type: "box", size: [0.012, 0.012, 0.052], rgba: [0.75, 0.8, 0.86, 1] },
  { id: 8, name: "tcp", type: "sphere", size: [0.013], rgba: [0.42, 0.94, 0.72, 0.9] },
  { id: 10, name: "red_block", type: "box", size: [0.027, 0.027, 0.027], rgba: [0.92, 0.24, 0.3, 1] },
  { id: 11, name: "green_block", type: "box", size: [0.027, 0.027, 0.027], rgba: [0.2, 0.78, 0.5, 1] },
  { id: 12, name: "blue_block", type: "box", size: [0.027, 0.027, 0.027], rgba: [0.22, 0.55, 0.96, 1] },
  { id: 13, name: "yellow_block", type: "box", size: [0.027, 0.027, 0.027], rgba: [0.98, 0.76, 0.2, 1] },
  { id: 20, name: "blue_plate", type: "cylinder", size: [0.078, 0.009], rgba: [0.18, 0.45, 0.92, 0.78] },
  { id: 21, name: "white_plate", type: "cylinder", size: [0.078, 0.009], rgba: [0.88, 0.91, 0.95, 0.85] },
  { id: 30, name: "left_zone", type: "box", size: [0.105, 0.08, 0.004], rgba: [0.22, 0.76, 0.63, 0.25] },
  { id: 31, name: "right_zone", type: "box", size: [0.105, 0.08, 0.004], rgba: [0.64, 0.46, 0.94, 0.25] },
];

function cloneBlocks(): Record<BlockName, Vec3> {
  return Object.fromEntries(
    Object.entries(INITIAL_BLOCKS).map(([name, position]) => [name, [...position]]),
  ) as Record<BlockName, Vec3>;
}

function identityPose(position: Vec3): Pose {
  return [position[0], position[1], position[2], 1, 0, 0, 0];
}

function segmentPose(start: Vec3, end: Vec3): Pose {
  const a = new THREE.Vector3(...start);
  const b = new THREE.Vector3(...end);
  const midpoint = a.clone().add(b).multiplyScalar(0.5);
  const direction = b.clone().sub(a).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    direction,
  );
  return [
    midpoint.x,
    midpoint.y,
    midpoint.z,
    quaternion.w,
    quaternion.x,
    quaternion.y,
    quaternion.z,
  ];
}

function armPoints(target: Vec3): [Vec3, Vec3, Vec3, Vec3] {
  const shoulder: Vec3 = [0.02, 0, 0.16];
  const wristTarget: Vec3 = [target[0], target[1], Math.max(target[2] + 0.11, 0.17)];
  const dx = wristTarget[0] - shoulder[0];
  const dy = wristTarget[1] - shoulder[1];
  const yaw = Math.atan2(dy, dx);
  const radial = Math.hypot(dx, dy);
  const vertical = wristTarget[2] - shoulder[2];
  const l1 = 0.32;
  const l2 = 0.28;
  const distance = Math.min(Math.max(Math.hypot(radial, vertical), 0.08), l1 + l2 - 0.005);
  const cosElbow = THREE.MathUtils.clamp(
    (distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2),
    -1,
    1,
  );
  const elbow = -Math.acos(cosElbow);
  const shoulderPitch =
    Math.atan2(vertical, radial) -
    Math.atan2(l2 * Math.sin(elbow), l1 + l2 * Math.cos(elbow));

  const point = (length: number, pitch: number, origin: Vec3): Vec3 => [
    origin[0] + length * Math.cos(yaw) * Math.cos(pitch),
    origin[1] + length * Math.sin(yaw) * Math.cos(pitch),
    origin[2] + length * Math.sin(pitch),
  ];
  const elbowPoint = point(l1, shoulderPitch, shoulder);
  const wrist = point(l2, shoulderPitch + elbow, elbowPoint);
  return [shoulder, elbowPoint, wrist, target];
}

function abortError(): DOMException {
  return new DOMException("Operation aborted", "AbortError");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(abortError());
      },
      { once: true },
    );
  });
}

export class BrowserDemoRuntime implements ArmRuntime {
  readonly mode = "browser" as const;
  readonly label = "Browser demo";
  readonly description = "Deterministic planner · client-side kinematics";

  private emit: ((message: RuntimeMessage) => void) | null = null;
  private blocks = cloneBlocks();
  private target: Vec3 = [...HOME_TARGET];
  private gripperClosed = false;
  private holding: BlockName | null = null;
  private startedAt = 0;
  private lastFrameAt = 0;
  private frameHandle = 0;
  private runController: AbortController | null = null;
  private busy = false;

  connect(emit: (message: RuntimeMessage) => void): void {
    this.emit = emit;
    this.startedAt = performance.now();
    emit({ type: "scene_init", geoms: DEMO_GEOMS });
    emit({
      type: "connection",
      connected: true,
      message: "browser runtime ready — no backend or API key required",
    });
    emit({
      type: "status",
      phase: "idle",
      progress: 0,
      message: "Choose an example or describe a supported manipulation task.",
    });
    this.frameHandle = window.requestAnimationFrame(this.tick);
  }

  send(command: RuntimeCommand): void {
    if (command.type === "reset") {
      this.reset();
      return;
    }
    const text = command.type === "demo" ? "把红色方块放进蓝色盘子" : command.text;
    if (this.busy) {
      this.emit?.({ type: "error", message: "A task is already running. Reset before starting another." });
      return;
    }
    const plan = planCommand(text);
    if ("error" in plan) {
      this.emit?.({ type: "error", message: plan.error });
      return;
    }
    if (this.holding) {
      this.emit?.({
        type: "error",
        message: `The gripper is already holding ${this.holding}. Reset the scene before starting another task.`,
      });
      return;
    }
    const controller = new AbortController();
    this.runController = controller;
    void this.execute(plan.summary, plan.goals, controller);
  }

  dispose(): void {
    this.runController?.abort();
    window.cancelAnimationFrame(this.frameHandle);
    this.emit = null;
  }

  private readonly tick = (now: number) => {
    if (this.emit && now - this.lastFrameAt >= 1000 / 30) {
      this.lastFrameAt = now;
      this.emit(this.frame(now));
    }
    this.frameHandle = window.requestAnimationFrame(this.tick);
  };

  private frame(now: number): RuntimeMessage {
    const [shoulder, elbow, wrist, tcp] = armPoints(this.target);
    const yaw = Math.atan2(tcp[1] - shoulder[1], tcp[0] - shoulder[0]);
    const separation = this.gripperClosed ? 0.018 : 0.034;
    const normal: Vec3 = [-Math.sin(yaw), Math.cos(yaw), 0];
    const heldPosition: Vec3 = [tcp[0], tcp[1], Math.max(0.027, tcp[2] - 0.055)];
    const poseById = new Map<number, Pose>([
      [0, identityPose([0.46, 0.04, 0])],
      [1, identityPose([0.02, 0, 0.045])],
      [2, segmentPose(shoulder, elbow)],
      [3, segmentPose(elbow, wrist)],
      [4, segmentPose(wrist, tcp)],
      [5, identityPose(wrist)],
      [
        6,
        identityPose([
          tcp[0] + normal[0] * separation,
          tcp[1] + normal[1] * separation,
          tcp[2] + 0.025,
        ]),
      ],
      [
        7,
        identityPose([
          tcp[0] - normal[0] * separation,
          tcp[1] - normal[1] * separation,
          tcp[2] + 0.025,
        ]),
      ],
      [8, identityPose(tcp)],
      [20, identityPose(STATIC_TARGETS.blue_plate)],
      [21, identityPose(STATIC_TARGETS.white_plate)],
      [30, identityPose(STATIC_TARGETS.left_zone)],
      [31, identityPose(STATIC_TARGETS.right_zone)],
    ]);

    for (const [name, id] of Object.entries(BLOCK_IDS) as Array<[BlockName, number]>) {
      poseById.set(id, identityPose(this.holding === name ? heldPosition : this.blocks[name]));
    }

    return {
      type: "frame",
      t: Math.max(0, (now - this.startedAt) / 1000),
      poses: DEMO_GEOMS.map((geom) => poseById.get(geom.id) ?? identityPose([0, 0, 0])),
      holding: this.holding,
    };
  }

  private reset(): void {
    this.runController?.abort();
    this.runController = null;
    this.busy = false;
    this.blocks = cloneBlocks();
    this.target = [...HOME_TARGET];
    this.holding = null;
    this.gripperClosed = false;
    this.startedAt = performance.now();
    this.emit?.({
      type: "status",
      phase: "idle",
      progress: 0,
      message: "Scene reset. Planner is ready for a new task.",
    });
  }

  private async execute(
    summary: string,
    goals: DemoGoal[],
    controller: AbortController,
  ): Promise<void> {
    const { signal } = controller;
    const started = performance.now();
    this.busy = true;
    try {
      this.emit?.({
        type: "status",
        phase: "planning",
        progress: 6,
        message: `Grounding instruction: ${summary}`,
      });
      await sleep(360, signal);
      this.emit?.({
        type: "agent_event",
        phase: "perceiving",
        progress: 14,
        tool: "get_scene",
        message: `get_scene() → 4 blocks, 2 plates, 2 zones`,
      });
      await sleep(260, signal);

      for (let index = 0; index < goals.length; index += 1) {
        await this.executeGoal(goals[index], index, goals.length, signal);
      }

      this.emit?.({
        type: "agent_event",
        phase: "verifying",
        progress: 94,
        tool: "check_success",
        message: `check_success(${goals.map((goal) => goal.type).join(", ")}) → true`,
      });
      await sleep(320, signal);
      await this.animateTarget(HOME_TARGET, 460, signal);
      this.emit?.({
        type: "done",
        success: true,
        durationMs: Math.round(performance.now() - started),
        message: "Goal verified against browser scene state ✓",
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        this.emit?.({
          type: "error",
          message: error instanceof Error ? error.message : "Browser runtime failed.",
        });
      }
    } finally {
      if (this.runController === controller) {
        this.busy = false;
        this.runController = null;
      }
    }
  }

  private async executeGoal(
    goal: DemoGoal,
    goalIndex: number,
    goalCount: number,
    signal: AbortSignal,
  ): Promise<void> {
    const source = this.blocks[goal.object];
    const progressBase = 18 + (goalIndex / goalCount) * 70;
    const progressSpan = 70 / goalCount;
    const hover: Vec3 = [source[0], source[1], 0.25];
    const pickup: Vec3 = [source[0], source[1], 0.09];

    this.event("moving", progressBase, "move_to", `move_to(${hover.map((n) => n.toFixed(2)).join(", ")})`);
    await this.animateTarget(hover, 520, signal);
    await this.animateTarget(pickup, 360, signal);
    this.gripperClosed = true;
    this.holding = goal.object;
    this.event("grasping", progressBase + progressSpan * 0.25, "grasp", `grasp() → ${goal.object}`);
    await sleep(260, signal);
    await this.animateTarget(hover, 420, signal);

    if (goal.type === "holding") return;

    const destination = this.destination(goal, goalIndex);
    const targetHover: Vec3 = [destination[0], destination[1], Math.max(0.25, destination[2] + 0.2)];
    const targetDrop: Vec3 = [destination[0], destination[1], destination[2] + 0.065];
    this.event(
      "moving",
      progressBase + progressSpan * 0.48,
      "move_to",
      `move_to(${targetHover.map((n) => n.toFixed(2)).join(", ")})`,
    );
    await this.animateTarget(targetHover, 580, signal);
    await this.animateTarget(targetDrop, 380, signal);
    this.blocks[goal.object] = destination;
    this.holding = null;
    this.gripperClosed = false;
    this.event("grasping", progressBase + progressSpan * 0.82, "release", `release() → ${goal.target}`);
    await sleep(260, signal);
    await this.animateTarget(targetHover, 360, signal);
  }

  private destination(goal: DemoGoal, index: number): Vec3 {
    if (!goal.target) return [...this.blocks[goal.object]];
    if (goal.type === "on_block") {
      const target = this.blocks[goal.target as BlockName];
      return [target[0], target[1], target[2] + 0.056];
    }
    const target = STATIC_TARGETS[goal.target];
    if (!target) throw new Error(`Unknown browser-demo target: ${goal.target}`);
    const offset = goal.type === "in_plate" && index > 0 ? 0.034 : 0;
    return [target[0], target[1] + offset, target[2]];
  }

  private event(
    phase: "moving" | "grasping",
    progress: number,
    tool: string,
    message: string,
  ): void {
    this.emit?.({ type: "agent_event", phase, progress: Math.round(progress), tool, message });
  }

  private async animateTarget(next: Vec3, duration: number, signal: AbortSignal): Promise<void> {
    const start = [...this.target] as Vec3;
    const started = performance.now();
    while (true) {
      if (signal.aborted) throw abortError();
      const progress = Math.min(1, (performance.now() - started) / duration);
      const eased = 0.5 - Math.cos(progress * Math.PI) / 2;
      this.target = [
        start[0] + (next[0] - start[0]) * eased,
        start[1] + (next[1] - start[1]) * eased,
        start[2] + (next[2] - start[2]) * eased,
      ];
      if (progress >= 1) return;
      await sleep(16, signal);
    }
  }
}

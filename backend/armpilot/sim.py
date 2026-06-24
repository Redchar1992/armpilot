"""SimEnv: MuJoCo Franka Panda tabletop world with discrete motion primitives.

Design notes:
- The LLM agent only ever calls the discrete primitives (move_to / grasp /
  release); continuous control is classical: DLS IK + position actuators.
- grasp() closes the fingers AND activates a weld equality between the hand
  and the nearest block (suction-style attach). This trades physical realism
  for the reliability an eval suite needs; see README "design tradeoffs".
- Thread-safe: a single RLock guards stepping and state reads so a WebSocket
  broadcaster can sample poses at 30 Hz while a primitive is executing.
"""

import os
import threading
import time

import mujoco
import numpy as np

from .ik import IKSolver

ASSET_DIR = os.path.join(os.path.dirname(__file__), "..", "assets")
SCENE_XML = os.path.join(ASSET_DIR, "franka_emika_panda", "armpilot_scene.xml")

ARM_JOINTS = [f"joint{i}" for i in range(1, 8)]
HOME_QPOS = np.array([0.0, 0.3, 0.0, -1.57079, 0.0, 2.0, -0.7853])
DOWN_QUAT = np.array([0.0, 1.0, 0.0, 0.0])  # gripper pointing straight down

BLOCKS = ["red_block", "green_block", "blue_block", "yellow_block"]
PLATES = ["blue_plate", "white_plate"]
ZONES = ["left_zone", "right_zone"]

DEFAULT_BLOCK_XY = {
    "red_block": (0.45, 0.15),
    "green_block": (0.45, -0.15),
    "blue_block": (0.55, 0.28),
    "yellow_block": (0.5, -0.28),
}

BLOCK_HALF = 0.02
GRIPPER_OPEN = 255.0
GRIPPER_CLOSED_ON_BLOCK = 110.0  # ~17mm per finger, light squeeze on a 20mm half-width cube
MAX_JOINT_SPEED = 1.2  # rad/s, caps interpolation speed for smooth visuals

WORKSPACE_LO = np.array([0.25, -0.45, 0.018])
WORKSPACE_HI = np.array([0.72, 0.45, 0.6])


class SimEnv:
    def __init__(self, realtime=False):
        self.model = mujoco.MjModel.from_xml_path(SCENE_XML)
        self.data = mujoco.MjData(self.model)
        self.realtime = realtime
        self.lock = threading.RLock()
        self.busy = False
        self.held = None
        self.dt = self.model.opt.timestep

        m = self.model
        self.site_id = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_SITE, "grip_site")
        self.hand_bid = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, "hand")
        jids = [mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n) for n in ARM_JOINTS]
        self.arm_qpos_ids = np.array([m.jnt_qposadr[j] for j in jids])
        self.block_bids = {n: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, n) for n in BLOCKS}
        self.plate_bids = {n: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_BODY, n) for n in PLATES}
        self.zone_gids = {n: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_GEOM, n) for n in ZONES}
        self.block_qpos_adr = {
            n: m.jnt_qposadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, n)] for n in BLOCKS
        }
        self.weld_ids = {
            n: mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_EQUALITY, f"weld_{n}") for n in BLOCKS
        }
        self.ik = IKSolver(m, "grip_site", ARM_JOINTS, HOME_QPOS)
        self._stream_gids = self._select_stream_geoms()
        self._default_plate_pos = {n: m.body_pos[b].copy() for n, b in self.plate_bids.items()}
        self.reset()

    # ------------------------------------------------------------- lifecycle

    def reset(self, blocks=None, plates=None):
        """blocks/plates: optional {name: [x, y]} overrides."""
        with self.lock:
            mujoco.mj_resetData(self.model, self.data)
            self.data.qpos[self.arm_qpos_ids] = HOME_QPOS
            self.data.ctrl[0:7] = HOME_QPOS
            self.data.ctrl[7] = GRIPPER_OPEN
            xy = dict(DEFAULT_BLOCK_XY)
            if blocks:
                xy.update({k: tuple(v) for k, v in blocks.items()})
            for name, (x, y) in xy.items():
                adr = self.block_qpos_adr[name]
                self.data.qpos[adr:adr + 7] = [x, y, BLOCK_HALF, 1, 0, 0, 0]
            for name, default in self._default_plate_pos.items():
                self.model.body_pos[self.plate_bids[name]] = default
            if plates:
                for name, (x, y) in plates.items():
                    self.model.body_pos[self.plate_bids[name]][0:2] = (x, y)
            self.data.eq_active[:] = self.model.eq_active0
            self.held = None
            mujoco.mj_forward(self.model, self.data)
        self._run_steps(int(0.3 / self.dt), pace=False)

    # ------------------------------------------------------------ primitives

    def move_to(self, pos, quat=None):
        target = np.asarray(pos, dtype=float)
        pos = np.clip(target, WORKSPACE_LO, WORKSPACE_HI)
        if not np.allclose(pos, target):
            return {"ok": False,
                    "error": f"target {target.round(3).tolist()} is out of workspace "
                             f"(bounds {WORKSPACE_LO.tolist()} to {WORKSPACE_HI.tolist()})"}
        quat = DOWN_QUAT if quat is None else np.asarray(quat, dtype=float)
        with self.lock:
            q_now = self.data.qpos[self.arm_qpos_ids].copy()
        q_target, ik_ok = self.ik.solve(pos, quat, q_now)
        if not ik_ok:
            return {"ok": False, "error": f"IK failed: target {pos.round(3).tolist()} unreachable"}

        self.busy = True
        try:
            dist = float(np.max(np.abs(q_target - q_now)))
            duration = max(dist / MAX_JOINT_SPEED, 0.4)
            steps = max(int(duration / self.dt), 1)
            for i in range(steps):
                a = 0.5 - 0.5 * np.cos(np.pi * (i + 1) / steps)  # cosine ease in/out
                with self.lock:
                    self.data.ctrl[0:7] = q_now + a * (q_target - q_now)
                self._step_one()
            self._run_steps(int(0.15 / self.dt))
        finally:
            self.busy = False

        with self.lock:
            err = float(np.linalg.norm(self.data.site_xpos[self.site_id] - pos))
        if err > 0.02:
            return {"ok": False, "error": f"did not converge, ee is {err*1000:.0f}mm from target"}
        return {"ok": True, "ee_pos": self._round(self.data.site_xpos[self.site_id])}

    def grasp(self):
        if self.held:
            return {"ok": False, "error": f"already holding {self.held}"}
        with self.lock:
            site = self.data.site_xpos[self.site_id].copy()
            dists = {n: float(np.linalg.norm(self.data.xpos[b] - site))
                     for n, b in self.block_bids.items()}
        name, dist = min(dists.items(), key=lambda kv: kv[1])
        if dist > 0.06:
            return {"ok": False,
                    "error": f"no block within reach (nearest is {name}, {dist*1000:.0f}mm away); "
                             "move_to the block position first"}

        self.busy = True
        try:
            self._set_gripper(GRIPPER_CLOSED_ON_BLOCK, 0.4)
            self._activate_weld(name)
            self._run_steps(int(0.15 / self.dt))
        finally:
            self.busy = False

        with self.lock:
            still_near = float(np.linalg.norm(
                self.data.xpos[self.block_bids[name]] - self.data.site_xpos[self.site_id])) < 0.07
        if not still_near:
            self._deactivate_welds()
            return {"ok": False, "error": f"grasp on {name} slipped"}
        self.held = name
        return {"ok": True, "grasped": name}

    def release(self):
        self.busy = True
        try:
            self._deactivate_welds()
            self._set_gripper(GRIPPER_OPEN, 0.3)
            self._run_steps(int(0.6 / self.dt))  # let the object fall and settle
        finally:
            self.busy = False
        released = self.held
        self.held = None
        return {"ok": True, "released": released}

    # ------------------------------------------------------------- perception

    def get_scene(self):
        with self.lock:
            objects = []
            for n, b in self.block_bids.items():
                objects.append({"name": n, "type": "block", "color": n.split("_")[0],
                                "size": 2 * BLOCK_HALF, "pos": self._round(self.data.xpos[b])})
            for n, b in self.plate_bids.items():
                objects.append({"name": n, "type": "plate", "color": n.split("_")[0],
                                "radius": 0.07, "pos": self._round(self.data.xpos[b])})
            for n, g in self.zone_gids.items():
                objects.append({"name": n, "type": "zone",
                                "half_size": self._round(self.model.geom_size[g][0:2]),
                                "pos": self._round(self.data.geom_xpos[g])})
            return {"objects": objects,
                    "gripper": {"pos": self._round(self.data.site_xpos[self.site_id]),
                                "holding": self.held}}

    def check_success(self, goal):
        """goal: {type: in_plate|on_block|in_zone, object, target} -> {success, detail}"""
        obj, target, kind = goal.get("object"), goal.get("target"), goal.get("type")
        if obj not in self.block_bids:
            return {"success": False, "detail": f"unknown object {obj!r}"}
        if kind == "holding":
            ok = self.held == obj
            return {"success": ok, "detail": f"gripper is holding {self.held or 'nothing'}"}
        with self.lock:
            p = self.data.xpos[self.block_bids[obj]].copy()
            if self.held == obj:
                return {"success": False, "detail": f"{obj} is still held by the gripper"}
            if kind == "in_plate":
                if target not in self.plate_bids:
                    return {"success": False, "detail": f"unknown plate {target!r}"}
                c = self.data.xpos[self.plate_bids[target]]
                horiz = float(np.linalg.norm(p[0:2] - c[0:2]))
                ok = bool(horiz < 0.055 and p[2] < 0.06)
                return {"success": ok, "detail": f"{obj} is {horiz*1000:.0f}mm from {target} center, z={p[2]:.3f}"}
            if kind == "on_block":
                if target not in self.block_bids:
                    return {"success": False, "detail": f"unknown block {target!r}"}
                c = self.data.xpos[self.block_bids[target]]
                horiz = float(np.linalg.norm(p[0:2] - c[0:2]))
                dz = float(p[2] - c[2])
                ok = bool(horiz < 0.03 and 0.025 < dz < 0.055)
                return {"success": ok, "detail": f"horiz offset {horiz*1000:.0f}mm, dz {dz*1000:.0f}mm"}
            if kind == "in_zone":
                if target not in self.zone_gids:
                    return {"success": False, "detail": f"unknown zone {target!r}"}
                g = self.zone_gids[target]
                c = self.data.geom_xpos[g]
                hs = self.model.geom_size[g]
                ok = bool(abs(p[0] - c[0]) < hs[0] and abs(p[1] - c[1]) < hs[1] and p[2] < 0.06)
                return {"success": ok, "detail": f"{obj} at {self._round(p)}, zone center {self._round(c)}"}
        return {"success": False, "detail": f"unknown goal type {kind!r}"}

    # ----------------------------------------------------- streaming (for M1)

    def scene_description(self):
        """One-time init message: every streamed geom with shape/color/mesh data."""
        m = self.model
        geoms = []
        with self.lock:
            for g in self._stream_gids:
                gtype = m.geom_type[g]
                rgba = (m.mat_rgba[m.geom_matid[g]] if m.geom_matid[g] >= 0
                        else m.geom_rgba[g])
                entry = {
                    "id": int(g),
                    "name": mujoco.mj_id2name(m, mujoco.mjtObj.mjOBJ_GEOM, g) or f"geom{g}",
                    "type": mujoco.mjtGeom(gtype).name.replace("mjGEOM_", "").lower(),
                    "size": m.geom_size[g].tolist(),
                    "rgba": np.asarray(rgba, dtype=float).round(4).tolist(),
                }
                if gtype == mujoco.mjtGeom.mjGEOM_MESH:
                    mid = m.geom_dataid[g]
                    va, vn = m.mesh_vertadr[mid], m.mesh_vertnum[mid]
                    fa, fn = m.mesh_faceadr[mid], m.mesh_facenum[mid]
                    entry["verts"] = m.mesh_vert[va:va + vn].astype(np.float32).round(5).flatten().tolist()
                    entry["faces"] = m.mesh_face[fa:fa + fn].flatten().tolist()
                geoms.append(entry)
        return {"type": "scene_init", "geoms": geoms}

    def get_frame(self):
        """Per-frame world pose of every streamed geom."""
        quat = np.zeros(4)
        with self.lock:
            poses = []
            for g in self._stream_gids:
                mujoco.mju_mat2Quat(quat, self.data.geom_xmat[g].reshape(9))
                poses.append([*self._round(self.data.geom_xpos[g]), *quat.round(4).tolist()])
            return {"type": "frame", "t": round(self.data.time, 3), "poses": poses,
                    "holding": self.held}

    def idle_step(self):
        """Step physics once while no primitive is running (server keep-alive loop)."""
        if not self.busy:
            self._step_one()
        elif self.realtime:
            time.sleep(self.dt)

    # -------------------------------------------------------------- internals

    def _select_stream_geoms(self):
        m = self.model
        gids = []
        for g in range(m.ngeom):
            if m.geom_group[g] == 3:  # collision-only geoms
                continue
            rgba = m.mat_rgba[m.geom_matid[g]] if m.geom_matid[g] >= 0 else m.geom_rgba[g]
            if rgba[3] == 0:
                continue
            gids.append(g)
        return gids

    def _set_gripper(self, ctrl_target, duration):
        with self.lock:
            start = float(self.data.ctrl[7])
        steps = max(int(duration / self.dt), 1)
        for i in range(steps):
            with self.lock:
                self.data.ctrl[7] = start + (ctrl_target - start) * (i + 1) / steps
            self._step_one()

    def _activate_weld(self, name):
        eq = self.weld_ids[name]
        with self.lock:
            d, m = self.data, self.model
            p1, q1 = d.xpos[self.hand_bid], d.xquat[self.hand_bid]
            p2, q2 = d.xpos[self.block_bids[name]], d.xquat[self.block_bids[name]]
            r1 = np.zeros(9)
            mujoco.mju_quat2Mat(r1, q1)
            p_rel = r1.reshape(3, 3).T @ (p2 - p1)
            q1_neg, q_rel = np.zeros(4), np.zeros(4)
            mujoco.mju_negQuat(q1_neg, q1)
            mujoco.mju_mulQuat(q_rel, q1_neg, q2)
            m.eq_data[eq][0:3] = 0.0          # anchor
            m.eq_data[eq][3:6] = p_rel        # relpose: position
            m.eq_data[eq][6:10] = q_rel       # relpose: orientation
            m.eq_data[eq][10] = 1.0           # torquescale
            d.eq_active[eq] = 1

    def _deactivate_welds(self):
        with self.lock:
            for eq in self.weld_ids.values():
                self.data.eq_active[eq] = 0

    def _run_steps(self, n, pace=None):
        for _ in range(n):
            self._step_one(pace)

    def _step_one(self, pace=None):
        t0 = time.perf_counter()
        with self.lock:
            mujoco.mj_step(self.model, self.data)
        if pace if pace is not None else self.realtime:
            leftover = self.dt - (time.perf_counter() - t0)
            if leftover > 0:
                time.sleep(leftover)

    @staticmethod
    def _round(v):
        return np.asarray(v, dtype=float).round(4).tolist()

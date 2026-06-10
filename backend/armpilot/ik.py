"""Damped-least-squares inverse kinematics for a site target.

Kinematics-only iteration on a scratch mjData — no dynamics involved, so it is
cheap enough to run per motion command.
"""

import mujoco
import numpy as np


class IKSolver:
    def __init__(self, model, site_name, joint_names, q_pref):
        self.model = model
        self.data = mujoco.MjData(model)
        self.site_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, site_name)
        if self.site_id < 0:
            raise ValueError(f"site {site_name!r} not found")
        jids = [mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_JOINT, n) for n in joint_names]
        self.qpos_ids = np.array([model.jnt_qposadr[j] for j in jids])
        self.dof_ids = np.array([model.jnt_dofadr[j] for j in jids])
        self.q_lo = np.array([model.jnt_range[j][0] for j in jids])
        self.q_hi = np.array([model.jnt_range[j][1] for j in jids])
        self.q_pref = np.asarray(q_pref, dtype=float)

    def solve(self, target_pos, target_quat, q_init, max_iters=200, pos_tol=1e-3,
              rot_tol=5e-3, damping=1e-2, step=1.0, null_gain=0.05):
        """Return (q, ok). q_init/q are arrays over the controlled joints."""
        m, d = self.model, self.data
        target_pos = np.asarray(target_pos, dtype=float)
        target_quat = np.asarray(target_quat, dtype=float)
        d.qpos[:] = 0.0
        d.qpos[self.qpos_ids] = q_init
        q = np.array(q_init, dtype=float)

        site_quat = np.zeros(4)
        err_quat = np.zeros(4)
        neg_quat = np.zeros(4)
        rot_err = np.zeros(3)
        jacp = np.zeros((3, m.nv))
        jacr = np.zeros((3, m.nv))
        ok = False

        for _ in range(max_iters):
            mujoco.mj_kinematics(m, d)
            mujoco.mj_comPos(m, d)

            pos_err = target_pos - d.site_xpos[self.site_id]
            mujoco.mju_mat2Quat(site_quat, d.site_xmat[self.site_id].reshape(9))
            mujoco.mju_negQuat(neg_quat, site_quat)
            mujoco.mju_mulQuat(err_quat, target_quat, neg_quat)
            mujoco.mju_quat2Vel(rot_err, err_quat, 1.0)

            if np.linalg.norm(pos_err) < pos_tol and np.linalg.norm(rot_err) < rot_tol:
                ok = True
                break

            mujoco.mj_jacSite(m, d, jacp, jacr, self.site_id)
            jac = np.vstack([jacp[:, self.dof_ids], jacr[:, self.dof_ids]])  # 6 x 7
            err = np.concatenate([pos_err, rot_err])

            dq = jac.T @ np.linalg.solve(jac @ jac.T + damping**2 * np.eye(6), err)
            # Nullspace bias toward the preferred (home-like) posture
            jac_pinv = np.linalg.pinv(jac)
            dq += (np.eye(len(q)) - jac_pinv @ jac) @ (self.q_pref - q) * null_gain

            q = np.clip(q + step * dq, self.q_lo, self.q_hi)
            d.qpos[self.qpos_ids] = q

        return q, ok

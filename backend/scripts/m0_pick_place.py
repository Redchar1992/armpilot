"""M0 acceptance: scripted pick-and-place, headless.

Picks the red block and places it on the blue plate using only the motion
primitives, then asserts the in_plate success criterion.
"""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from armpilot.sim import SimEnv


def must(result, what):
    print(f"  {what}: {result}")
    assert result.get("ok"), f"{what} failed: {result}"
    return result


def main():
    env = SimEnv(realtime=False)
    scene = env.get_scene()
    red = next(o for o in scene["objects"] if o["name"] == "red_block")
    plate = next(o for o in scene["objects"] if o["name"] == "blue_plate")
    rx, ry, rz = red["pos"]
    px, py, _ = plate["pos"]
    print(f"red_block at {red['pos']}, blue_plate at {plate['pos']}")

    must(env.move_to([rx, ry, rz + 0.12]), "move above block")
    must(env.move_to([rx, ry, 0.025]), "descend to grasp height")
    must(env.grasp(), "grasp")
    must(env.move_to([rx, ry, 0.2]), "lift")

    held_z = env.get_scene()["objects"][0]["pos"][2]
    assert held_z > 0.1, f"block did not follow gripper on lift (z={held_z}) — weld not working"
    print(f"  weld check: block z={held_z:.3f} while lifted, OK")

    must(env.move_to([px, py, 0.2]), "move above plate")
    must(env.move_to([px, py, 0.06]), "descend over plate")
    must(env.release(), "release")
    must(env.move_to([0.4, 0.0, 0.3]), "retreat home")

    verdict = env.check_success({"type": "in_plate", "object": "red_block", "target": "blue_plate"})
    print(f"  success check: {verdict}")
    assert verdict["success"], f"M0 FAILED: {verdict['detail']}"
    print("M0 PASS: red block is in the blue plate")


if __name__ == "__main__":
    main()

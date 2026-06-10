"""Scripted pick-and-place demo, reusable from the M0 script and the server."""

DEMO_GOAL = {"type": "in_plate", "object": "red_block", "target": "blue_plate"}


def run_demo(env, emit=lambda msg: None):
    env.reset()
    emit("scene reset")
    scene = env.get_scene()
    red = next(o for o in scene["objects"] if o["name"] == "red_block")
    plate = next(o for o in scene["objects"] if o["name"] == "blue_plate")
    rx, ry, _ = red["pos"]
    px, py, _ = plate["pos"]

    steps = [
        ("move above red block", lambda: env.move_to([rx, ry, 0.15])),
        ("descend to grasp height", lambda: env.move_to([rx, ry, 0.025])),
        ("grasp", env.grasp),
        ("lift", lambda: env.move_to([rx, ry, 0.2])),
        ("move above blue plate", lambda: env.move_to([px, py, 0.2])),
        ("descend over plate", lambda: env.move_to([px, py, 0.06])),
        ("release", env.release),
        ("retreat", lambda: env.move_to([0.4, 0.0, 0.3])),
    ]
    for desc, fn in steps:
        result = fn()
        emit(f"{desc}: {'ok' if result.get('ok') else result.get('error')}")
        if not result.get("ok"):
            return False

    verdict = env.check_success(DEMO_GOAL)
    emit(f"success check: {verdict['detail']}")
    return verdict["success"]

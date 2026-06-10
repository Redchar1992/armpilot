"""M2 acceptance: five command families (zh + en) end-to-end with the mock
planner. Success is verified independently via env.check_success — the
agent's self-report is not trusted."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from armpilot.agent import MockPlanner, run_command
from armpilot.sim import SimEnv

CASES = [
    ("把红色方块放进蓝色盘子", {"type": "in_plate", "object": "red_block", "target": "blue_plate"}),
    ("Put the green block in the white plate", {"type": "in_plate", "object": "green_block", "target": "white_plate"}),
    ("把蓝色方块叠到绿色方块上面", {"type": "on_block", "object": "blue_block", "target": "green_block"}),
    ("Move the yellow block to the left zone", {"type": "in_zone", "object": "yellow_block", "target": "left_zone"}),
    ("拿起红色方块", {"type": "holding", "object": "red_block"}),
]


def main():
    env = SimEnv(realtime=False)
    passed = 0
    for i, (command, goal) in enumerate(CASES, 1):
        env.reset()
        result = run_command(env, command, planner=MockPlanner())
        truth = env.check_success(goal)
        ok = result["success"] and truth["success"]
        passed += ok
        print(f"[{i}/{len(CASES)}] {'PASS' if ok else 'FAIL'}  {command!r}")
        print(f"        agent={result['success']} truth={truth['success']} ({truth['detail']})")
    print(f"\n{passed}/{len(CASES)} passed")
    assert passed == len(CASES), "M2 FAILED"
    print("M2 PASS")


if __name__ == "__main__":
    main()

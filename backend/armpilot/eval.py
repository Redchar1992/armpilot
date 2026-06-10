"""M3 eval harness: run the task suite headless, verify against ground truth,
emit a markdown success-rate report.

Usage:
  python -m armpilot.eval                  # planner: claude if API key set, else mock
  python -m armpilot.eval --planner mock
  python -m armpilot.eval --limit 5 --out /tmp/report.md
"""

import argparse
import datetime
import json
import os
import time

from .agent import ClaudePlanner, MockPlanner, run_command
from .sim import SimEnv

HERE = os.path.dirname(__file__)
DEFAULT_TASKS = os.path.join(HERE, "..", "tasks", "tasks.json")
DEFAULT_OUT = os.path.join(HERE, "..", "tasks", "report.md")


def run_eval(planner_name, tasks_path=DEFAULT_TASKS, out_path=DEFAULT_OUT, limit=None):
    with open(tasks_path) as f:
        tasks = json.load(f)["tasks"]
    if limit:
        tasks = tasks[:limit]

    make_planner = ClaudePlanner if planner_name == "claude" else MockPlanner
    env = SimEnv(realtime=False)
    rows = []
    for task in tasks:
        env.reset(blocks=task.get("blocks"), plates=task.get("plates"))
        t0 = time.time()
        result = run_command(env, task["instruction"], planner=make_planner())
        wall = time.time() - t0
        checks = [env.check_success(g) for g in task["goals"]]
        success = all(c["success"] for c in checks)
        rows.append({
            "id": task["id"], "family": task["family"], "instruction": task["instruction"],
            "agent_ok": result["success"], "success": success, "wall": wall,
            "detail": "; ".join(c["detail"] for c in checks),
        })
        print(f"[{task['id']:>2}] {'PASS' if success else 'FAIL'} ({wall:5.1f}s) {task['instruction']}")

    n_pass = sum(r["success"] for r in rows)
    rate = n_pass / len(rows) * 100

    families = {}
    for r in rows:
        families.setdefault(r["family"], []).append(r["success"])

    lines = [
        "# ArmPilot Eval Report",
        "",
        f"- date: {datetime.datetime.now():%Y-%m-%d %H:%M}",
        f"- planner: **{planner_name}**",
        f"- tasks: {len(rows)}",
        f"- **success rate: {n_pass}/{len(rows)} ({rate:.0f}%)**",
        "",
        "## By family",
        "",
        "| family | passed | total |",
        "|---|---|---|",
    ]
    for fam, results in families.items():
        lines.append(f"| {fam} | {sum(results)} | {len(results)} |")
    lines += [
        "",
        "## Tasks",
        "",
        "| # | family | instruction | result | wall (s) | ground-truth detail |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        mark = "✅" if r["success"] else "❌"
        lines.append(f"| {r['id']} | {r['family']} | {r['instruction']} | {mark} "
                     f"| {r['wall']:.1f} | {r['detail']} |")
    report = "\n".join(lines) + "\n"
    with open(out_path, "w") as f:
        f.write(report)
    print(f"\nsuccess rate: {n_pass}/{len(rows)} ({rate:.0f}%)  ->  {os.path.abspath(out_path)}")
    return n_pass, len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--planner", choices=["mock", "claude"],
                    default="claude" if os.environ.get("ANTHROPIC_API_KEY") else "mock")
    ap.add_argument("--tasks", default=DEFAULT_TASKS)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()
    run_eval(args.planner, args.tasks, args.out, args.limit)


if __name__ == "__main__":
    main()

"""Language -> action agent layer.

Two interchangeable planners drive the same tool surface:
- ClaudePlanner: real LLM tool-calling via the Anthropic API (needs
  ANTHROPIC_API_KEY). The LLM plans discrete primitive calls; it never does
  continuous control.
- MockPlanner: deterministic zh/en command parser producing the same tool
  sequences. Used when no API key is set, and as the reproducible eval
  baseline.

Selection: ARMPILOT_PLANNER=claude|mock, default claude iff ANTHROPIC_API_KEY
is set.
"""

import json
import os
import re

MAX_ATTEMPTS = 3

TOOLS = [
    {
        "name": "get_scene",
        "description": "Return every object on the table (blocks, plates, zones) with world "
                       "positions in meters, plus the gripper position and what it is holding.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "move_to",
        "description": "Move the gripper TCP to a world position [x, y, z] (meters), keeping it "
                       "pointed straight down. Returns ok or an error.",
        "input_schema": {
            "type": "object",
            "properties": {"pos": {"type": "array", "items": {"type": "number"},
                                   "minItems": 3, "maxItems": 3}},
            "required": ["pos"],
        },
    },
    {
        "name": "grasp",
        "description": "Close the gripper on the nearest block (must be within 6cm of the TCP).",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "release",
        "description": "Open the gripper and release whatever is held.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "check_success",
        "description": "Verify a goal against ground truth. Call this after acting; if it fails, "
                       "re-plan and retry.",
        "input_schema": {
            "type": "object",
            "properties": {
                "goal": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string",
                                 "enum": ["in_plate", "on_block", "in_zone", "holding"]},
                        "object": {"type": "string"},
                        "target": {"type": "string"},
                    },
                    "required": ["type", "object"],
                },
            },
            "required": ["goal"],
        },
    },
]

SYSTEM_PROMPT = """You control a Franka Panda arm on a tabletop through discrete tools. \
Blocks are 4cm cubes resting at z=0.02; plates are 14cm-diameter discs on the table; zones are \
marked areas. Commands may be in Chinese or English.

Motion conventions (follow exactly):
- Always approach from above: move_to [x, y, 0.15] over the object before descending.
- To grasp a block: descend to its [x, y, 0.025], then grasp, then lift to [x, y, 0.2].
- To place: move above the target at z=0.2, descend to z=0.07 (or z=0.065+target block top when \
stacking on a block), release, then lift back to z=0.2.
- When placing several objects into the same plate, offset each drop a few cm apart so they sit \
side by side instead of stacking.
- Workspace: x in [0.3, 0.7], y in [-0.4, 0.4].

Always call get_scene first to read current positions — never assume them. After acting, verify \
with check_success using the goal that matches the user's command (in_plate / on_block / in_zone / \
holding). If it reports failure, re-read the scene and retry (at most {max_attempts} total \
attempts), then stop and explain. Keep going until the goal is verified; be concise.""".format(
    max_attempts=MAX_ATTEMPTS)


class ToolExecutor:
    def __init__(self, env, emit=lambda m: None):
        self.env = env
        self.emit = emit
        self.last_check = None

    def execute(self, name, args):
        if name == "get_scene":
            result = self.env.get_scene()
        elif name == "move_to":
            result = self.env.move_to(args["pos"])
        elif name == "grasp":
            result = self.env.grasp()
        elif name == "release":
            result = self.env.release()
        elif name == "check_success":
            result = self.env.check_success(args["goal"])
            self.last_check = result
        else:
            result = {"ok": False, "error": f"unknown tool {name}"}
        brief = result if name != "get_scene" else f"{len(result['objects'])} objects"
        self.emit(f"{name}({json.dumps(args, ensure_ascii=False) if args else ''}) -> {brief}")
        return result


# --------------------------------------------------------------------- Claude

class ClaudePlanner:
    name = "claude"

    def __init__(self, model=None):
        import anthropic
        self._anthropic = anthropic
        self.client = anthropic.Anthropic()
        self.model = model or os.environ.get("ARMPILOT_MODEL", "claude-fable-5")

    def _create(self, **kwargs):
        """messages.create with patient backoff — third-party gateways throw
        transient 503/429 bursts that outlast the SDK's quick default retries."""
        import time
        for delay in (2, 5, 10, 20, None):
            try:
                return self.client.messages.create(**kwargs)
            except (self._anthropic.APIStatusError, self._anthropic.APIConnectionError) as e:
                status = getattr(e, "status_code", None)
                retryable = status is None or status == 429 or status >= 500
                if not retryable or delay is None:
                    raise
                time.sleep(delay)

    def run(self, command, executor):
        messages = [{"role": "user", "content": command}]
        for _ in range(48):  # hard cap on tool round-trips
            response = self._create(
                model=self.model, max_tokens=1500, system=SYSTEM_PROMPT,
                tools=TOOLS, messages=messages,
            )
            tool_uses = [b for b in response.content if b.type == "tool_use"]
            texts = [b.text for b in response.content if b.type == "text"]
            for t in texts:
                executor.emit(f"[agent] {t}")
            if not tool_uses:
                break
            messages.append({"role": "assistant", "content": response.content})
            results = []
            for tu in tool_uses:
                out = executor.execute(tu.name, tu.input or {})
                results.append({"type": "tool_result", "tool_use_id": tu.id,
                                "content": json.dumps(out, ensure_ascii=False)})
            messages.append({"role": "user", "content": results})
        check = executor.last_check
        return bool(check and check.get("success"))


# ----------------------------------------------------------------------- Mock

COLORS = {"红": "red", "绿": "green", "蓝": "blue", "黄": "yellow",
          "red": "red", "green": "green", "blue": "blue", "yellow": "yellow"}
PLATE_COLORS = {"蓝": "blue", "白": "white", "blue": "blue", "white": "white"}
ZONES = {"左": "left_zone", "右": "right_zone", "left": "left_zone", "right": "right_zone"}

BLOCK_WORDS = r"(?:方块|积木|block|cube)"
PLATE_WORDS = r"(?:盘子|盘|plate|dish)"


class MockPlanner:
    """Deterministic parser for the five supported command families:
    1. put <color> block in <color> plate     把红色方块放进蓝色盘子
    2. stack <color> block on <color> block   把蓝色方块叠到绿色方块上
    3. move <color> block to left/right zone  把黄色方块移到左边区域
    4. pick up <color> block                  拿起红色方块
    5. put <colors> blocks in <color> plate   把红色和绿色方块都放进白色盘子
    """
    name = "mock"

    def run(self, command, executor):
        parsed = self.parse(command)
        if parsed is None:
            executor.emit("[mock] could not parse command")
            return False
        goals, plans = parsed
        offsets = self._place_offsets(goals)
        for attempt in range(1, MAX_ATTEMPTS + 1):
            ok = True
            for block, goal, offset in zip(plans, goals, offsets):
                self._execute_plan(block, goal, executor, offset)
                if not executor.execute("check_success", {"goal": goal})["success"]:
                    ok = False
            if ok:
                return True
            executor.emit(f"[mock] attempt {attempt} failed, re-planning")
        return False

    @staticmethod
    def _place_offsets(goals):
        """Spread drops a few cm apart when several goals share a target plate."""
        spread = [(-0.025, 0.0), (0.03, 0.0), (0.0, -0.03), (0.0, 0.03)]
        per_target = {}
        offsets = []
        for g in goals:
            tgt = g.get("target")
            shared = sum(1 for x in goals if x.get("target") == tgt) > 1
            i = per_target.get(tgt, 0)
            per_target[tgt] = i + 1
            offsets.append(spread[i % len(spread)] if shared else (0.0, 0.0))
        return offsets

    def parse(self, text):
        t = text.lower()
        if not re.search(BLOCK_WORDS, t):
            return None
        # bind the plate phrase first, then strip it so its color word can't
        # be mistaken for a block color ("blue plate" vs "blue block")
        plate = None
        m = re.search(rf"(蓝|白|blue|white)\s*(?:色|colored)?\s*{PLATE_WORDS}", t)
        if m:
            plate = f"{PLATE_COLORS[m.group(1)]}_plate"
            t = t.replace(m.group(0), " ")
        zone = next((z for k, z in ZONES.items() if k in t), None)
        blocks = self._find_blocks(t)
        if not blocks:
            return None
        stack_on = len(blocks) >= 2 and re.search(r"叠|上面|上方|on top|stack|放到|onto", t)

        if stack_on:
            goal = {"type": "on_block", "object": blocks[0], "target": blocks[1]}
            return [goal], [blocks[0]]
        if plate:
            goals = [{"type": "in_plate", "object": b, "target": plate} for b in blocks]
            return goals, blocks
        if zone:
            goals = [{"type": "in_zone", "object": b, "target": zone} for b in blocks]
            return goals, blocks
        if re.search(r"拿起|抓起|抓住|pick up|grab|hold", t):
            return [{"type": "holding", "object": blocks[0]}], [blocks[0]]
        return None

    def _find_blocks(self, t):
        found = []
        for m in re.finditer(r"\b(red|green|blue|yellow)\b|(红|绿|蓝|黄)", t):
            color = COLORS[m.group(1) or m.group(2)]
            if f"{color}_block" not in found:
                found.append(f"{color}_block")
        return found

    def _execute_plan(self, block, goal, ex, offset=(0.0, 0.0)):
        scene = ex.execute("get_scene", {})
        pos = {o["name"]: o["pos"] for o in scene["objects"]}
        bx, by, _ = pos[block]
        # pick
        ex.execute("move_to", {"pos": [bx, by, 0.15]})
        ex.execute("move_to", {"pos": [bx, by, 0.025]})
        ex.execute("grasp", {})
        ex.execute("move_to", {"pos": [bx, by, 0.2]})
        if goal["type"] == "holding":
            return
        # place
        tx, ty, tz = pos[goal["target"]]
        tx, ty = tx + offset[0], ty + offset[1]
        drop_z = 0.065 + tz + 0.02 if goal["type"] == "on_block" else 0.07
        ex.execute("move_to", {"pos": [tx, ty, 0.2]})
        ex.execute("move_to", {"pos": [tx, ty, drop_z]})
        ex.execute("release", {})
        ex.execute("move_to", {"pos": [tx, ty, 0.2]})


def make_planner():
    choice = os.environ.get("ARMPILOT_PLANNER")
    if choice == "mock":
        return MockPlanner()
    if choice == "claude" or os.environ.get("ANTHROPIC_API_KEY"):
        return ClaudePlanner()
    return MockPlanner()


def run_command(env, command, emit=lambda m: None, planner=None):
    """Entry point used by the server and the eval harness."""
    planner = planner or make_planner()
    executor = ToolExecutor(env, emit)
    emit(f"[planner: {planner.name}] {command}")
    try:
        success = planner.run(command, executor)
    except Exception as e:
        emit(f"[agent] crashed: {e}")
        return {"success": False, "planner": planner.name, "error": str(e)}
    return {"success": bool(success), "planner": planner.name}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { planCommand } from "./planner";

describe("browser demo planner", () => {
  it("grounds a Chinese plate command", () => {
    expect(planCommand("把红色方块放进蓝色盘子")).toMatchObject({
      family: "in_plate",
      goals: [{ type: "in_plate", object: "red_block", target: "blue_plate" }],
    });
  });

  it("grounds an English stack command", () => {
    expect(planCommand("Stack the blue block on the green block")).toMatchObject({
      family: "on_block",
      goals: [{ type: "on_block", object: "blue_block", target: "green_block" }],
    });
  });

  it("supports zone and holding goals", () => {
    expect(planCommand("把黄色方块移到左边区域")).toMatchObject({
      family: "in_zone",
      goals: [{ type: "in_zone", object: "yellow_block", target: "left_zone" }],
    });
    expect(planCommand("Pick up the green block")).toMatchObject({
      family: "holding",
      goals: [{ type: "holding", object: "green_block" }],
    });
  });

  it("creates one verified goal per object in a multi-object instruction", () => {
    const result = planCommand("把红色方块和绿色方块都放进白色盘子");
    expect(result).toMatchObject({ family: "multi" });
    if ("error" in result) throw new Error(result.error);
    expect(result.goals).toEqual([
      { type: "in_plate", object: "red_block", target: "white_plate" },
      { type: "in_plate", object: "green_block", target: "white_plate" },
    ]);
  });

  it("returns actionable errors for unsupported instructions", () => {
    expect(planCommand("wave hello")).toEqual({
      error: "I could not identify a colored block. Try one of the example tasks.",
    });
    expect(planCommand("move the red block")).toEqual({
      error: "I found the object, but not the goal. Try plate, stack, zone, or pick-up wording.",
    });
  });

  it("grounds the complete 20-task MuJoCo evaluation corpus", () => {
    const suite = JSON.parse(
      readFileSync(new URL("../../backend/tasks/tasks.json", import.meta.url), "utf8"),
    ) as { tasks: Array<{ instruction: string; goals: unknown[] }> };
    for (const task of suite.tasks) {
      const result = planCommand(task.instruction);
      if ("error" in result) throw new Error(`${task.instruction}: ${result.error}`);
      expect(result.goals, task.instruction).toEqual(task.goals);
    }
  });
});

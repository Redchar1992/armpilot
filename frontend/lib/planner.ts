export type BlockColor = "red" | "green" | "blue" | "yellow";
export type PlateColor = "blue" | "white";

export type DemoGoal = {
  type: "in_plate" | "on_block" | "in_zone" | "holding";
  object: `${BlockColor}_block`;
  target?: string;
};

export type DemoPlan = {
  family: "in_plate" | "on_block" | "in_zone" | "holding" | "multi";
  summary: string;
  goals: DemoGoal[];
};

type ColorName = BlockColor | "white";

const COLOR_ALIASES: Record<ColorName, string[]> = {
  red: ["red", "红"],
  green: ["green", "绿"],
  blue: ["blue", "蓝"],
  yellow: ["yellow", "黄"],
  white: ["white", "白"],
};

export const EXAMPLE_COMMANDS = [
  "把红色方块放进蓝色盘子",
  "Stack the blue block on the green block",
  "把黄色方块移到左边区域",
  "Pick up the green block",
];

function indexedColors(text: string, nounPattern: string): Array<{ color: ColorName; index: number }> {
  const matches: Array<{ color: ColorName; index: number }> = [];
  for (const [color, aliases] of Object.entries(COLOR_ALIASES) as Array<
    [ColorName, string[]]
  >) {
    for (const alias of aliases) {
      const patterns = alias.length === 1
        ? [new RegExp(`${alias}(?:色)?(?:${nounPattern})`, "gi")]
        : [new RegExp(`${alias}\\s+(?:${nounPattern})`, "gi")];
      for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
          matches.push({ color, index: match.index ?? 0 });
        }
      }
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

function blockColors(text: string): BlockColor[] {
  return indexedColors(text, "方块|积木|block|cube")
    .map((match) => match.color)
    .filter((color): color is BlockColor => color !== "white");
}

function plateColor(text: string): PlateColor | null {
  const color = indexedColors(text, "盘子|托盘|plate|tray")[0]?.color;
  return color === "blue" || color === "white" ? color : null;
}

function blockName(color: BlockColor): `${BlockColor}_block` {
  return `${color}_block`;
}

export function planCommand(raw: string): DemoPlan | { error: string } {
  const text = raw.trim();
  const normalized = text.toLowerCase();
  if (!text) return { error: "Enter a task before running the planner." };

  const blocks = blockColors(normalized);
  if (!blocks.length) {
    return {
      error: "I could not identify a colored block. Try one of the example tasks.",
    };
  }

  const wantsPlate = /盘子|托盘|plate|tray/.test(normalized);
  const wantsStack = /叠|上面|stack|onto|on top/.test(normalized);
  const wantsZone = /区域|左边|右边|zone|left|right/.test(normalized);
  const wantsHold = /拿起|抓起|举起|pick up|grasp|hold/.test(normalized);

  if (wantsStack) {
    if (blocks.length < 2) {
      return { error: "A stack task needs both a source block and a target block." };
    }
    return {
      family: "on_block",
      summary: `Stack ${blocks[0]} on ${blocks[1]}`,
      goals: [
        {
          type: "on_block",
          object: blockName(blocks[0]),
          target: blockName(blocks[1]),
        },
      ],
    };
  }

  if (wantsPlate) {
    const target = plateColor(normalized);
    if (!target) return { error: "Choose either the blue plate or the white plate." };
    const uniqueBlocks = [...new Set(blocks)];
    return {
      family: uniqueBlocks.length > 1 ? "multi" : "in_plate",
      summary: `Place ${uniqueBlocks.join(" + ")} in the ${target} plate`,
      goals: uniqueBlocks.map((color) => ({
        type: "in_plate",
        object: blockName(color),
        target: `${target}_plate`,
      })),
    };
  }

  if (wantsZone) {
    const side = /左边|left/.test(normalized)
      ? "left"
      : /右边|right/.test(normalized)
        ? "right"
        : null;
    if (!side) return { error: "Choose the left zone or the right zone." };
    return {
      family: "in_zone",
      summary: `Move ${blocks[0]} to the ${side} zone`,
      goals: [
        {
          type: "in_zone",
          object: blockName(blocks[0]),
          target: `${side}_zone`,
        },
      ],
    };
  }

  if (wantsHold) {
    return {
      family: "holding",
      summary: `Pick up ${blocks[0]}`,
      goals: [{ type: "holding", object: blockName(blocks[0]) }],
    };
  }

  return {
    error: "I found the object, but not the goal. Try plate, stack, zone, or pick-up wording.",
  };
}


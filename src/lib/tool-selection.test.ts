import { describe, expect, it } from "vitest";

import {
  addTools,
  dayToolList,
  expandKit,
  kitsFrom,
  resolveTool,
  resolveTools,
} from "@/lib/tool-selection";
import type { Tool } from "@/types/domain";

function tool(id: string, name: string, kits: number[] = [], is_rental = false): Tool {
  return { id, name, kits, is_rental } as unknown as Tool;
}

const TOOLS = [
  tool("t1", "Wheelbarrow", [1]),
  tool("t2", "Hedge trimmer", [2]),
  tool("t3", "Leaf blower", [1, 2]),
  tool("t4", "Plate compactor", [], true),
];

describe("resolveTool", () => {
  it("resolves a stored name, which is what zones actually hold", () => {
    expect(resolveTool("Wheelbarrow", TOOLS)?.id).toBe("t1");
  });

  it("resolves an id, which is what the service link table holds", () => {
    expect(resolveTool("t2", TOOLS)?.name).toBe("Hedge trimmer");
  });

  it("matches a name whatever its casing or padding", () => {
    expect(resolveTool("  leaf BLOWER ", TOOLS)?.id).toBe("t3");
  });

  it("returns nothing for a tool that no longer exists", () => {
    // Better than printing the leftover token, which is the bug that showed
    // a run of random characters where a tool name belonged.
    expect(resolveTool("8f3a9c21-dead-beef", TOOLS)).toBeNull();
  });
});

describe("resolveTools", () => {
  it("drops tokens it cannot place rather than showing them", () => {
    expect(resolveTools(["Wheelbarrow", "8f3a-gone"], TOOLS).map((t) => t.name)).toEqual([
      "Wheelbarrow",
    ]);
  });

  it("does not list the same tool twice when stored by both name and id", () => {
    expect(resolveTools(["t1", "Wheelbarrow"], TOOLS)).toHaveLength(1);
  });

  it("keeps the order they were chosen in", () => {
    expect(resolveTools(["Leaf blower", "Wheelbarrow"], TOOLS).map((t) => t.name)).toEqual([
      "Leaf blower",
      "Wheelbarrow",
    ]);
  });
});

describe("kitsFrom", () => {
  it("lists each kit with its tools, sorted", () => {
    expect(kitsFrom(TOOLS)).toEqual([
      { number: 1, toolNames: ["Leaf blower", "Wheelbarrow"] },
      { number: 2, toolNames: ["Hedge trimmer", "Leaf blower"] },
    ]);
  });

  it("ignores tools in no kit", () => {
    expect(kitsFrom(TOOLS).every((k) => !k.toolNames.includes("Plate compactor"))).toBe(true);
  });

  it("is empty when nothing is kitted", () => {
    expect(kitsFrom([tool("x", "Rake")])).toEqual([]);
  });
});

describe("expandKit", () => {
  it("gives the names picking a kit adds", () => {
    expect(expandKit(1, TOOLS).sort()).toEqual(["Leaf blower", "Wheelbarrow"]);
  });

  it("is empty for a kit nobody is in", () => {
    expect(expandKit(9, TOOLS)).toEqual([]);
  });
});

describe("addTools", () => {
  it("adds what is missing", () => {
    expect(addTools(["Wheelbarrow"], ["Leaf blower"])).toEqual(["Wheelbarrow", "Leaf blower"]);
  });

  it("does not duplicate what is already picked", () => {
    // Picking two overlapping kits must not list Leaf blower twice.
    expect(addTools(["Leaf blower"], ["Hedge trimmer", "Leaf blower"])).toEqual([
      "Leaf blower",
      "Hedge trimmer",
    ]);
  });

  it("treats a differently-cased name as the same tool", () => {
    expect(addTools(["Wheelbarrow"], ["wheelbarrow"])).toEqual(["Wheelbarrow"]);
  });
});

describe("dayToolList", () => {
  const stops = [
    { label: "12 Elm St", toolTokens: ["Wheelbarrow", "Leaf blower"] },
    { label: "40 Oak Ave", toolTokens: ["Leaf blower", "Plate compactor"] },
  ];

  it("lists each tool once for the whole day", () => {
    expect(dayToolList(stops, TOOLS).map((l) => l.name)).toEqual([
      "Plate compactor",
      "Leaf blower",
      "Wheelbarrow",
    ]);
  });

  it("puts rentals first, since they have to be collected before the day starts", () => {
    expect(dayToolList(stops, TOOLS)[0].name).toBe("Plate compactor");
  });

  it("says which stops need each tool", () => {
    const blower = dayToolList(stops, TOOLS).find((l) => l.name === "Leaf blower")!;
    expect(blower.jobLabels).toEqual(["12 Elm St", "40 Oak Ave"]);
  });

  it("does not repeat a stop that needs the same tool twice", () => {
    const list = dayToolList([{ label: "12 Elm St", toolTokens: ["t1", "Wheelbarrow"] }], TOOLS);
    expect(list[0].jobLabels).toEqual(["12 Elm St"]);
  });

  it("is empty for a day with no stops", () => {
    expect(dayToolList([], TOOLS)).toEqual([]);
  });
});

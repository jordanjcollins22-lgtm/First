import { describe, expect, it } from "vitest";

import {
  UNITS,
  costOf,
  costOfMany,
  describeQuantity,
  hours,
  isTimeUnit,
  money,
  unitDef,
} from "@/lib/knowledge-cost";
import type { Graph, GraphEdge, GraphNode, RelationshipType } from "@/lib/knowledge-graph";

function node(
  id: string,
  title: string,
  nodeType: GraphNode["nodeType"] = "idea",
  cost: number | null = null,
  unit = "each"
): GraphNode {
  return {
    id,
    title,
    nodeType,
    status: "idea",
    description: null,
    importance: null,
    estimatedCost: cost,
    unit,
    potentialValue: null,
    notes: null,
    tags: [],
    positionX: null,
    positionY: null,
    scheduledFor: null,
    recurrence: "none",
    recurrenceInterval: 1,
    lastDoneAt: null,
    timesDone: 0,
    createdBy: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function edge(
  id: string,
  sourceId: string,
  targetId: string,
  quantity: number | null = null,
  relationshipType: RelationshipType = "requires"
): GraphEdge {
  return { id, sourceId, targetId, relationshipType, strength: 3, quantity, notes: null };
}

// The user's own example, priced: two thousand door hangers on cardstock,
// a toner cartridge, and four hours of somebody's design time.
const PRINT: Graph = {
  nodes: [
    node("hangers", "Door hangers"),
    node("card", "Cardstock", "material", 0.12, "sheet"),
    node("toner", "Toner", "material", 89, "each"),
    node("design", "Design time", "skill", 45, "hour"),
  ],
  edges: [
    edge("e1", "hangers", "card", 2000, "requires_material"),
    edge("e2", "hangers", "toner", 1, "requires_material"),
    edge("e3", "hangers", "design", 4, "requires_skill"),
  ],
};

describe("costOf", () => {
  it("adds materials up from the price of one unit", () => {
    const cost = costOf(PRINT, "hangers");
    // 2,000 sheets at 12c, plus one 89-dollar cartridge.
    expect(cost.materials).toBeCloseTo(329, 5);
  });

  it("keeps time apart from materials", () => {
    const cost = costOf(PRINT, "hangers");
    expect(cost.labour).toBe(180);
    expect(cost.hours).toBe(4);
    expect(cost.total).toBeCloseTo(509, 5);
  });

  it("returns nothing for a node with no requirements", () => {
    expect(costOf(PRINT, "card").total).toBe(0);
  });

  it("returns nothing for a node that isn't there", () => {
    expect(costOf(PRINT, "missing").total).toBe(0);
  });

  it("does not charge a resource for the things that use it", () => {
    // Walking backwards would make the cardstock cost what the door hangers
    // cost, which is the opposite of true.
    expect(costOf(PRINT, "toner").total).toBe(0);
  });

  it("counts an unpriced input once rather than as free", () => {
    const graph: Graph = {
      nodes: [node("idea", "Yard signs"), node("signs", "Corrugated signs", "material")],
      edges: [edge("e", "idea", "signs", 50)],
    };
    const cost = costOf(graph, "idea");
    expect(cost.total).toBe(0);
    expect(cost.unpriced.map((n) => n.title)).toEqual(["Corrugated signs"]);
  });

  it("treats a missing quantity as one", () => {
    const graph: Graph = {
      nodes: [node("idea", "Signage"), node("sign", "Sign", "material", 30)],
      edges: [edge("e", "idea", "sign", null)],
    };
    expect(costOf(graph, "idea").total).toBe(30);
  });

  it("ignores connections that are not about being made of something", () => {
    const graph: Graph = {
      nodes: [node("a", "Door hangers"), node("b", "Flyers", "idea", 500)],
      edges: [edge("e", "a", "b", 1, "similar_to")],
    };
    // Resembling an expensive idea does not cost anything.
    expect(costOf(graph, "a").total).toBe(0);
  });

  it("goes down through a layer of decomposition", () => {
    // Door hangers require a print run; the print run is what needs paper.
    const layered: Graph = {
      nodes: [
        node("hangers", "Door hangers"),
        node("run", "Print run", "process"),
        node("card", "Cardstock", "material", 0.1, "sheet"),
      ],
      edges: [edge("e1", "hangers", "run", 2), edge("e2", "run", "card", 1000)],
    };
    // Two runs of a thousand sheets at ten cents.
    expect(costOf(layered, "hangers").materials).toBeCloseTo(200, 5);
  });

  it("stops at the depth limit rather than running away", () => {
    const chain: Graph = {
      nodes: [
        node("a", "A"),
        node("b", "B", "process"),
        node("c", "C", "process"),
        node("d", "D", "material", 10),
      ],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "c"), edge("e3", "c", "d")],
    };
    expect(costOf(chain, "a", 4).total).toBe(10);
    expect(costOf(chain, "a", 1).total).toBe(0);
  });

  it("survives a cycle", () => {
    const cyclic: Graph = {
      nodes: [node("a", "A"), node("b", "B", "process", 5)],
      edges: [edge("e1", "a", "b"), edge("e2", "b", "a")],
    };
    expect(() => costOf(cyclic, "a")).not.toThrow();
    expect(costOf(cyclic, "a").total).toBe(5);
  });

  it("lists what it charged for, deepest last", () => {
    const cost = costOf(PRINT, "hangers");
    expect(cost.lines).toHaveLength(3);
    expect(cost.lines.every((l) => l.depth === 0)).toBe(true);
    expect(cost.lines.find((l) => l.node.title === "Cardstock")?.amount).toBeCloseTo(240, 5);
  });
});

describe("costOfMany", () => {
  it("adds up a week of work", () => {
    const graph: Graph = {
      nodes: [
        node("a", "Door hangers"),
        node("b", "Flyers"),
        node("card", "Cardstock", "material", 0.1, "sheet"),
      ],
      edges: [edge("e1", "a", "card", 1000), edge("e2", "b", "card", 500)],
    };
    // Fifteen hundred sheets, because both runs need their own paper —
    // sharing the printer does not share the paper.
    expect(costOfMany(graph, ["a", "b"]).materials).toBeCloseTo(150, 5);
  });

  it("reports each unpriced input once, however many ideas need it", () => {
    const graph: Graph = {
      nodes: [node("a", "A"), node("b", "B"), node("x", "Unpriced thing", "material")],
      edges: [edge("e1", "a", "x", 1), edge("e2", "b", "x", 1)],
    };
    expect(costOfMany(graph, ["a", "b"]).unpriced).toHaveLength(1);
  });

  it("is zero for nothing at all", () => {
    expect(costOfMany(PRINT, []).total).toBe(0);
  });
});

describe("units", () => {
  it("calls hours, days and weeks time and nothing else", () => {
    expect(isTimeUnit("hour")).toBe(true);
    expect(isTimeUnit("day")).toBe(true);
    expect(isTimeUnit("week")).toBe(true);
    // A monthly bill is money, not somebody's afternoon.
    expect(isTimeUnit("month")).toBe(false);
    expect(isTimeUnit("sheet")).toBe(false);
  });

  it("falls back to each for anything unrecognised", () => {
    expect(unitDef("nonsense").value).toBe("each");
  });

  it("converts days into hours when adding time up", () => {
    const graph: Graph = {
      nodes: [node("a", "Clean-up week"), node("crew", "Crew day", "role", 400, "day")],
      edges: [edge("e", "a", "crew", 3)],
    };
    const cost = costOf(graph, "a");
    expect(cost.hours).toBe(24);
    expect(cost.labour).toBe(1200);
  });

  it("has no duplicate unit values", () => {
    expect(new Set(UNITS.map((u) => u.value)).size).toBe(UNITS.length);
  });
});

describe("wording", () => {
  it("writes money without false precision", () => {
    expect(money(509)).toBe("$509");
    expect(money(1250)).toBe("$1,250");
    expect(money(12.5)).toBe("$12.50");
  });

  it("writes time the way somebody says it", () => {
    expect(hours(0)).toBe("0 hrs");
    expect(hours(1)).toBe("1 hr");
    expect(hours(4)).toBe("4 hrs");
    expect(hours(1.5)).toBe("1.5 hrs");
    expect(hours(24)).toBe("3 days");
  });

  it("writes a quantity with its unit", () => {
    expect(describeQuantity(2000, "sheet")).toBe("2000 sheets");
    expect(describeQuantity(4, "hour")).toBe("4 hours");
    expect(describeQuantity(1, "box")).toBe("1 box");
    expect(describeQuantity(1, "each")).toBe("1");
    // An abbreviation does not take an "s".
    expect(describeQuantity(3, "sq ft")).toBe("3 sq ft");
    expect(describeQuantity(12, "ft")).toBe("12 feet");
  });
});

describe("capital versus running cost", () => {
  // A printer is not a cost of printing. It is a cost of being able to print.
  const withPrinter: Graph = {
    nodes: [
      node("hangers", "Door hangers"),
      node("flyers", "Flyers"),
      node("printer", "Colour printer", "equipment", 420),
      node("card", "Cardstock", "material", 0.1, "sheet"),
    ],
    edges: [
      edge("e1", "hangers", "printer", 1, "requires_equipment"),
      edge("e2", "hangers", "card", 1000, "requires_material"),
      edge("e3", "flyers", "printer", 1, "requires_equipment"),
      edge("e4", "flyers", "card", 500, "requires_material"),
    ],
  };

  it("keeps kit out of what a run costs", () => {
    const cost = costOf(withPrinter, "hangers");
    expect(cost.materials).toBeCloseTo(100, 5);
    expect(cost.total).toBeCloseTo(100, 5);
    expect(cost.capital).toBe(420);
    expect(cost.capitalItems.map((n) => n.title)).toEqual(["Colour printer"]);
  });

  it("charges a shared printer once across a whole schedule, not once each", () => {
    // The entire point of spotting a shared resource is that it is one
    // purchase. Counting it twice would contradict the panel above it.
    const cost = costOfMany(withPrinter, ["hangers", "flyers"]);
    expect(cost.capital).toBe(420);
    expect(cost.materials).toBeCloseTo(150, 5);
  });

  it("does not multiply kit by how much of it a connection claims", () => {
    const graph: Graph = {
      nodes: [node("a", "Big print run"), node("p", "Printer", "equipment", 420)],
      edges: [edge("e", "a", "p", 5)],
    };
    expect(costOf(graph, "a").capital).toBe(420);
  });

  it("still treats consumables as consumed", () => {
    // Toner runs out. It is a material, and it is charged per run.
    const graph: Graph = {
      nodes: [node("a", "Print run"), node("t", "Toner", "material", 89)],
      edges: [edge("e", "a", "t", 2)],
    };
    expect(costOf(graph, "a").materials).toBe(178);
    expect(costOf(graph, "a").capital).toBe(0);
  });

  it("counts software as kit rather than as time", () => {
    const graph: Graph = {
      nodes: [node("a", "Design work"), node("s", "Design software", "software", 30, "month")],
      edges: [edge("e", "a", "s", 1)],
    };
    const cost = costOf(graph, "a");
    expect(cost.capital).toBe(30);
    expect(cost.hours).toBe(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  crossings,
  leverageSummary,
  notEarningYet,
  paybackOf,
  provenEarners,
} from "@/lib/knowledge-leverage";
import type { Graph, GraphEdge, GraphNode, NodeType, RelationshipType } from "@/lib/knowledge-graph";

function node(
  id: string,
  title: string,
  nodeType: NodeType = "idea",
  cost: number | null = null,
  unit = "each",
  potentialValue: number | null = null
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
    purchaseUrl: null,
    costBasis: null,
    unitHours: null,
    outputPerUnit: null,
    outputUnit: null,
    runSize: null,
    runUnit: null,
    fixedCost: null,
    isFee: false,
    durationHours: null,
    hourlyRate: null,
    materialId: null,
    toolId: null,
    materialName: null,
    stockOnHand: null,
    reorderThreshold: null,
    onOrder: false,
    potentialValue,
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

/**
 * Two ideas that reach the same printer by different routes, and only one of
 * them says "printer" anywhere on its own screen.
 */
const CROSSED: Graph = {
  nodes: [
    node("hangers", "Door hangers"),
    node("postcards", "Postcards"),
    node("run", "Print run", "process"),
    node("printer", "Colour printer", "equipment", 420),
    node("card", "Cardstock", "material", 0.1, "sheet"),
  ],
  edges: [
    // Door hangers go through a print run to get to the printer.
    edge("e1", "hangers", "run", 2),
    edge("e2", "run", "printer", 1, "requires_equipment"),
    edge("e3", "run", "card", 1000, "requires_material"),
    // Postcards go straight there.
    edge("e4", "postcards", "printer", 1, "requires_equipment"),
    edge("e5", "postcards", "card", 500, "requires_material"),
  ],
};

describe("crossings", () => {
  it("finds a meeting point neither idea names directly", () => {
    const found = crossings(CROSSED);
    const printer = found.find((c) => c.node.title === "Colour printer");
    expect(printer).toBeDefined();
    expect(printer!.through.map((t) => t.idea.title).sort()).toEqual(["Door hangers", "Postcards"]);
  });

  it("shows the route each idea takes to get there", () => {
    const printer = crossings(CROSSED).find((c) => c.node.title === "Colour printer")!;
    const viaRun = printer.through.find((t) => t.idea.title === "Door hangers")!;
    expect(viaRun.path.map((n) => n.title)).toEqual(["Print run", "Colour printer"]);
    expect(viaRun.depth).toBe(1);

    const direct = printer.through.find((t) => t.idea.title === "Postcards")!;
    expect(direct.path.map((n) => n.title)).toEqual(["Colour printer"]);
    expect(direct.depth).toBe(0);
  });

  it("marks a crossing indirect when at least one idea gets there through something else", () => {
    const printer = crossings(CROSSED).find((c) => c.node.title === "Colour printer")!;
    expect(printer.indirect).toBe(true);
  });

  it("adds up what the crossing consumes between them", () => {
    // Two runs of a thousand sheets, plus five hundred for the postcards.
    const card = crossings(CROSSED).find((c) => c.node.title === "Cardstock")!;
    expect(card.totalQuantity).toBe(2500);
    expect(card.totalAmount).toBeCloseTo(250, 5);
  });

  it("counts kit once however many ideas run through it", () => {
    const printer = crossings(CROSSED).find((c) => c.node.title === "Colour printer")!;
    expect(printer.totalAmount).toBe(420);
  });

  it("puts the crossings nobody could already see first", () => {
    const found = crossings(CROSSED);
    expect(found[0].indirect).toBe(true);
  });

  it("ignores a resource only one idea reaches", () => {
    const graph: Graph = {
      nodes: [node("a", "Door hangers"), node("b", "Radio ad"), node("x", "Cardstock", "material", 1)],
      edges: [edge("e", "a", "x", 10)],
    };
    expect(crossings(graph)).toHaveLength(0);
  });

  it("does not report ideas as crossings of each other", () => {
    const graph: Graph = {
      nodes: [node("a", "A"), node("b", "B"), node("shared", "Shared idea")],
      edges: [edge("e1", "a", "shared"), edge("e2", "b", "shared")],
    };
    expect(crossings(graph)).toHaveLength(0);
  });

  it("leaves archived ideas out", () => {
    const graph: Graph = {
      nodes: [
        node("a", "Live"),
        { ...node("b", "Retired campaign"), status: "archived" as const },
        node("x", "Cardstock", "material", 1),
      ],
      edges: [edge("e1", "a", "x", 1), edge("e2", "b", "x", 1)],
    };
    expect(crossings(graph)).toHaveLength(0);
  });
});

describe("paybackOf", () => {
  // The user's example: a flyer is paper going through six hundred doors, and
  // paper going through six hundred doors has advertising space on it.
  const FLYERS: Graph = {
    nodes: [
      node("flyers", "Flyers"),
      node("card", "Cardstock", "material", 0.1, "sheet"),
      node("ads", "Ad spot on the flyer", "revenue_source", null, "each", 75),
    ],
    edges: [
      edge("e1", "flyers", "card", 2000, "requires_material"),
      edge("e2", "flyers", "ads", 6, "generates_revenue"),
    ],
  };

  it("adds up what an idea earns", () => {
    const payback = paybackOf(FLYERS, "flyers");
    expect(payback.revenue).toBe(450);
    expect(payback.lines[0].node.title).toBe("Ad spot on the flyer");
  });

  it("sets the earnings against what a run costs", () => {
    const payback = paybackOf(FLYERS, "flyers");
    expect(payback.cost.total).toBeCloseTo(200, 5);
    expect(payback.net).toBeCloseTo(250, 5);
    expect(payback.coversItself).toBe(true);
  });

  it("does not count kit against the first run", () => {
    // Charging the printer to the first flyer run makes every idea look like
    // a loss until it has paid for the building.
    const withPrinter: Graph = {
      nodes: [...FLYERS.nodes, node("printer", "Printer", "equipment", 420)],
      edges: [...FLYERS.edges, edge("e3", "flyers", "printer", 1, "requires_equipment")],
    };
    expect(paybackOf(withPrinter, "flyers").net).toBeCloseTo(250, 5);
    expect(paybackOf(withPrinter, "flyers").cost.capital).toBe(420);
  });

  it("counts a revenue_source even without the revenue relationship", () => {
    const graph: Graph = {
      nodes: [node("a", "Newsletter"), node("s", "Sponsor slot", "revenue_source", null, "each", 200)],
      edges: [edge("e", "a", "s", 2)],
    };
    expect(paybackOf(graph, "a").revenue).toBe(400);
  });

  it("does not inherit somebody else's ad spot down a chain", () => {
    // One ad spot on a flyer must not make three other ideas look profitable.
    const graph: Graph = {
      nodes: [
        node("campaign", "Spring campaign"),
        node("flyers", "Flyers"),
        node("ads", "Ad spot", "revenue_source", null, "each", 75),
      ],
      edges: [edge("e1", "campaign", "flyers"), edge("e2", "flyers", "ads", 4, "generates_revenue")],
    };
    expect(paybackOf(graph, "campaign").revenue).toBe(0);
    expect(paybackOf(graph, "flyers").revenue).toBe(300);
  });

  it("flags an idea that costs money and answers nothing", () => {
    const graph: Graph = {
      nodes: [node("a", "Yard signs"), node("s", "Signs", "material", 4)],
      edges: [edge("e", "a", "s", 50)],
    };
    expect(paybackOf(graph, "a").unanswered).toBe(true);
  });

  it("does not nag about an idea that costs nothing", () => {
    const graph: Graph = { nodes: [node("a", "Ask for referrals")], edges: [] };
    expect(paybackOf(graph, "a").unanswered).toBe(false);
  });

  it("does not call it covered when the revenue is zero", () => {
    const graph: Graph = {
      nodes: [node("a", "Flyers"), node("s", "Unpriced ad spot", "revenue_source")],
      edges: [edge("e", "a", "s", 4, "generates_revenue")],
    };
    expect(paybackOf(graph, "a").coversItself).toBe(false);
  });
});

describe("notEarningYet", () => {
  it("lists the biggest unanswered spend first", () => {
    const graph: Graph = {
      nodes: [
        node("small", "Business cards"),
        node("big", "Direct mail"),
        node("paper", "Paper", "material", 1, "sheet"),
      ],
      edges: [edge("e1", "small", "paper", 100), edge("e2", "big", "paper", 5000)],
    };
    expect(notEarningYet(graph).map((g) => g.idea.title)).toEqual(["Direct mail", "Business cards"]);
  });

  it("leaves out anything already earning", () => {
    const graph: Graph = {
      nodes: [
        node("a", "Flyers"),
        node("paper", "Paper", "material", 1, "sheet"),
        node("ads", "Ad spot", "revenue_source", null, "each", 50),
      ],
      edges: [edge("e1", "a", "paper", 100), edge("e2", "a", "ads", 2, "generates_revenue")],
    };
    expect(notEarningYet(graph)).toHaveLength(0);
  });
});

describe("provenEarners", () => {
  it("points a working earner at the idea that crosses paths with it", () => {
    // Ad spots pay for the flyers. Door hangers go through the same paper and
    // the same doors, and nobody has asked the question about them.
    const graph: Graph = {
      nodes: [
        node("flyers", "Flyers"),
        node("hangers", "Door hangers"),
        node("card", "Cardstock", "material", 0.1, "sheet"),
        node("ads", "Ad spot", "revenue_source", null, "each", 75),
      ],
      edges: [
        edge("e1", "flyers", "card", 2000, "requires_material"),
        edge("e2", "hangers", "card", 1000, "requires_material"),
        edge("e3", "flyers", "ads", 6, "generates_revenue"),
      ],
    };

    const [suggestion] = provenEarners(graph);
    expect(suggestion.revenue.title).toBe("Ad spot");
    expect(suggestion.earningFrom.map((n) => n.title)).toEqual(["Flyers"]);
    expect(suggestion.couldAlsoEarn.map((n) => n.title)).toEqual(["Door hangers"]);
  });

  it("says nothing when the earner is already on everything it could be", () => {
    const graph: Graph = {
      nodes: [
        node("flyers", "Flyers"),
        node("hangers", "Door hangers"),
        node("card", "Cardstock", "material", 0.1, "sheet"),
        node("ads", "Ad spot", "revenue_source", null, "each", 75),
      ],
      edges: [
        edge("e1", "flyers", "card", 2000, "requires_material"),
        edge("e2", "hangers", "card", 1000, "requires_material"),
        edge("e3", "flyers", "ads", 6, "generates_revenue"),
        edge("e4", "hangers", "ads", 3, "generates_revenue"),
      ],
    };
    expect(provenEarners(graph)).toHaveLength(0);
  });

  it("does not suggest an earner for something unrelated", () => {
    const graph: Graph = {
      nodes: [
        node("flyers", "Flyers"),
        node("radio", "Radio spot"),
        node("card", "Cardstock", "material", 0.1, "sheet"),
        node("airtime", "Airtime", "material", 300),
        node("ads", "Ad spot", "revenue_source", null, "each", 75),
      ],
      edges: [
        edge("e1", "flyers", "card", 2000),
        edge("e2", "radio", "airtime", 1),
        edge("e3", "flyers", "ads", 6, "generates_revenue"),
      ],
    };
    // Nothing crosses, so there is nothing honest to say.
    expect(provenEarners(graph)).toHaveLength(0);
  });

  it("is empty when nothing earns anything yet", () => {
    expect(provenEarners(CROSSED)).toHaveLength(0);
  });
});

describe("leverageSummary", () => {
  it("totals what is going out and what is coming back", () => {
    const graph: Graph = {
      nodes: [
        node("flyers", "Flyers"),
        node("hangers", "Door hangers"),
        node("card", "Cardstock", "material", 0.1, "sheet"),
        node("ads", "Ad spot", "revenue_source", null, "each", 75),
      ],
      edges: [
        edge("e1", "flyers", "card", 2000),
        edge("e2", "hangers", "card", 1000),
        edge("e3", "flyers", "ads", 6, "generates_revenue"),
      ],
    };

    const summary = leverageSummary(graph);
    expect(summary.spending).toBeCloseTo(300, 5);
    expect(summary.earning).toBe(450);
    expect(summary.net).toBeCloseTo(150, 5);
    expect(summary.earningIdeas).toBe(1);
    expect(summary.totalIdeas).toBe(2);
  });

  it("is all zeroes for an empty graph", () => {
    expect(leverageSummary({ nodes: [], edges: [] })).toEqual({
      spending: 0,
      earning: 0,
      net: 0,
      earningIdeas: 0,
      totalIdeas: 0,
    });
  });
});

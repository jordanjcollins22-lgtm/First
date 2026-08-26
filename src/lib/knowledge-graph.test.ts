import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTERS,
  applyFilters,
  degreeMap,
  findSimilarNodes,
  isolatedNodes,
  localGraph,
  neighboursOf,
  nodeTypeDef,
  normaliseTitle,
  relationshipDef,
  type Graph,
  type GraphEdge,
  type GraphNode,
} from "@/lib/knowledge-graph";

function node(id: string, title: string, nodeType: GraphNode["nodeType"] = "idea"): GraphNode {
  return {
    id,
    title,
    nodeType,
    status: "idea",
    description: null,
    importance: null,
    estimatedCost: null,
    unit: "each",
    purchaseUrl: null,
    costBasis: null,
    unitHours: null,
    outputPerUnit: null,
    outputUnit: null,
    runSize: null,
    runUnit: null,
    fixedCost: null,
    materialId: null,
    toolId: null,
    materialName: null,
    stockOnHand: null,
    reorderThreshold: null,
    onOrder: false,
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
    createdAt: "2026-08-19T00:00:00Z",
    updatedAt: "2026-08-19T00:00:00Z",
  };
}

function edge(id: string, sourceId: string, targetId: string, type: GraphEdge["relationshipType"] = "uses"): GraphEdge {
  return { id, sourceId, targetId, relationshipType: type, strength: 3, quantity: null, notes: null };
}

/** The example from the brief: two marketing ideas, one printer. */
const PRINT_SHOP: Graph = {
  nodes: [
    node("hangers", "Door hangers"),
    node("flyers", "Flyers"),
    node("postcards", "Postcards"),
    node("paper", "Cardstock", "material"),
    node("printer", "Printer", "equipment"),
    node("toner", "Toner", "material"),
    node("design", "Graphic design", "skill"),
    node("leadgen", "Lead generation", "marketing_channel"),
    node("orphan", "Vague thought"),
  ],
  edges: [
    edge("e1", "hangers", "paper"),
    edge("e2", "hangers", "printer"),
    edge("e3", "hangers", "toner"),
    edge("e4", "hangers", "design", "requires_skill"),
    edge("e5", "flyers", "paper"),
    edge("e6", "flyers", "printer"),
    edge("e7", "flyers", "toner"),
    edge("e8", "flyers", "design", "requires_skill"),
    edge("e9", "postcards", "printer"),
    edge("e10", "hangers", "leadgen", "leads_to"),
  ],
};

describe("node and relationship vocabulary", () => {
  it("falls back rather than rendering an unknown type as blank", () => {
    expect(nodeTypeDef("nonsense").label).toBe("Other");
    expect(nodeTypeDef("printer_thing").color).toBeTruthy();
  });

  it("knows how a relationship reads backwards", () => {
    // So the printer's panel can say "used by flyers" without storing the
    // edge twice.
    expect(relationshipDef("uses").inverse).toBe("used by");
    expect(relationshipDef("requires").inverse).toBe("required by");
  });

  it("marks the symmetric ones as having no direction", () => {
    // An arrow on "similar to" claims a direction that is not there.
    expect(relationshipDef("similar_to").directional).toBe(false);
    expect(relationshipDef("uses").directional).toBe(true);
  });
});

describe("degreeMap", () => {
  it("counts edges in both directions", () => {
    // The printer's importance is entirely in its incoming edges.
    const degrees = degreeMap(PRINT_SHOP);
    expect(degrees.get("printer")).toBe(3);
    expect(degrees.get("hangers")).toBe(5);
  });

  it("gives an untouched node zero rather than leaving it out", () => {
    expect(degreeMap(PRINT_SHOP).get("orphan")).toBe(0);
  });
});

describe("neighboursOf", () => {
  it("walks edges backwards, which is the whole point", () => {
    // "What does the flyer need" is useful. "What needs the printer" is the
    // question that finds an asset worth buying.
    const around = neighboursOf(PRINT_SHOP, "printer");
    expect(around.map((n) => n.node.id).sort()).toEqual(["flyers", "hangers", "postcards"]);
    expect(around.every((n) => !n.outgoing)).toBe(true);
  });

  it("marks which way each edge points", () => {
    const around = neighboursOf(PRINT_SHOP, "hangers");
    expect(around.every((n) => n.outgoing)).toBe(true);
  });
});

describe("localGraph", () => {
  it("shows what touches a node at one hop", () => {
    const local = localGraph(PRINT_SHOP, "printer", 1);
    expect(local.nodes.map((n) => n.id).sort()).toEqual(["flyers", "hangers", "postcards", "printer"]);
  });

  it("reaches the shared story at two hops", () => {
    // The flyers that share the printer this idea needs — where the
    // connections nobody had noticed actually live.
    const local = localGraph(PRINT_SHOP, "postcards", 2);
    expect(local.nodes.map((n) => n.id)).toContain("hangers");
    expect(local.nodes.map((n) => n.id)).toContain("flyers");
  });

  it("keeps only edges whose both ends survived", () => {
    const local = localGraph(PRINT_SHOP, "printer", 1);
    const ids = new Set(local.nodes.map((n) => n.id));
    expect(local.edges.every((e) => ids.has(e.sourceId) && ids.has(e.targetId))).toBe(true);
  });

  it("returns just the node when nothing touches it", () => {
    expect(localGraph(PRINT_SHOP, "orphan", 2).nodes.map((n) => n.id)).toEqual(["orphan"]);
  });
});

describe("isolatedNodes", () => {
  it("finds the thought nobody finished", () => {
    expect(isolatedNodes(PRINT_SHOP).map((n) => n.id)).toEqual(["orphan"]);
  });
});

describe("duplicate detection", () => {
  it("matches the same thing written differently", () => {
    expect(normaliseTitle("Printers!")).toBe(normaliseTitle("printer"));
    expect(normaliseTitle("  Card  Stock ")).toBe("card stock");
  });

  it("suggests the existing printer before a second one is made", () => {
    // The graph is worth more when two ideas point at one printer than when
    // it holds two printers.
    const found = findSimilarNodes(PRINT_SHOP.nodes, "printer");
    expect(found[0].id).toBe("printer");
  });

  it("catches a longer name containing the existing one", () => {
    expect(findSimilarNodes(PRINT_SHOP.nodes, "laser printer").map((n) => n.id)).toContain("printer");
  });

  it("says nothing for a title too short to judge", () => {
    expect(findSimilarNodes(PRINT_SHOP.nodes, "a")).toEqual([]);
  });

  it("has no false match for a genuinely new thing", () => {
    expect(findSimilarNodes(PRINT_SHOP.nodes, "excavator")).toEqual([]);
  });
});

describe("applyFilters", () => {
  it("keeps everything by default", () => {
    expect(applyFilters(PRINT_SHOP, EMPTY_FILTERS).nodes).toHaveLength(PRINT_SHOP.nodes.length);
  });

  it("keeps a search's matches and what touches them", () => {
    // Searching "printer" and being shown one lonely dot answers a question
    // nobody asked.
    const filtered = applyFilters(PRINT_SHOP, { ...EMPTY_FILTERS, search: "printer" });
    const ids = filtered.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["flyers", "hangers", "postcards", "printer"]);
  });

  it("filters by node type", () => {
    const filtered = applyFilters(PRINT_SHOP, { ...EMPTY_FILTERS, nodeTypes: new Set(["material"]) });
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual(["paper", "toner"]);
  });

  it("filters by relationship type and drops the edges that fail", () => {
    const filtered = applyFilters(PRINT_SHOP, {
      ...EMPTY_FILTERS,
      relationshipTypes: new Set(["requires_skill"]),
    });
    expect(filtered.edges.every((e) => e.relationshipType === "requires_skill")).toBe(true);
  });

  it("hides disconnected nodes on request", () => {
    const filtered = applyFilters(PRINT_SHOP, { ...EMPTY_FILTERS, showIsolated: false });
    expect(filtered.nodes.map((n) => n.id)).not.toContain("orphan");
  });

  it("never leaves an edge pointing at a node that was filtered out", () => {
    const filtered = applyFilters(PRINT_SHOP, { ...EMPTY_FILTERS, nodeTypes: new Set(["idea"]) });
    const ids = new Set(filtered.nodes.map((n) => n.id));
    expect(filtered.edges.every((e) => ids.has(e.sourceId) && ids.has(e.targetId))).toBe(true);
  });

  it("filters by how connected a node is", () => {
    const filtered = applyFilters(PRINT_SHOP, { ...EMPTY_FILTERS, minConnections: 3 });
    expect(filtered.nodes.map((n) => n.id).sort()).toEqual(["flyers", "hangers", "printer"]);
  });
});

describe("applyFilters — scheduled only", () => {
  it("keeps only what has a date on it", () => {
    const graph: Graph = {
      nodes: [
        { ...node("a", "Door hangers"), scheduledFor: "2026-04-01" },
        node("b", "Someday: radio ad"),
      ],
      edges: [],
    };

    const filtered = applyFilters(graph, { ...EMPTY_FILTERS, scheduledOnly: true });
    expect(filtered.nodes.map((n) => n.id)).toEqual(["a"]);
  });

  it("leaves everything alone when it is off", () => {
    const graph: Graph = { nodes: [node("a", "One"), node("b", "Two")], edges: [] };
    expect(applyFilters(graph, EMPTY_FILTERS).nodes).toHaveLength(2);
  });
});

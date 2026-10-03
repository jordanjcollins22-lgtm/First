import { describe, expect, it } from "vitest";

import type { Graph, GraphEdge, GraphNode, NodeStatus } from "@/lib/knowledge-graph";
import {
  canSolve,
  describeIssue,
  issueColorFor,
  issueStateOf,
  ISSUE_COLORS,
  listIssues,
  openIssues,
  solutionsFor,
} from "./knowledge-issues";

function node(over: Partial<GraphNode> & { id: string; title: string }): GraphNode {
  return {
    nodeType: "idea",
    status: "idea" as NodeStatus,
    isIssue: false,
    imagePath: null,
    description: null,
    importance: null,
    estimatedCost: null,
    unit: "each",
    purchaseUrl: null,
    appRoute: null,
    costBasis: null,
    unitHours: null,
    outputPerUnit: null,
    outputUnit: null,
    runSize: null,
    runUnit: null,
    fixedCost: null,
    ...over,
  } as GraphNode;
}

function edge(source: string, target: string, type = "solved_by"): GraphEdge {
  return {
    id: `${source}->${target}`,
    sourceId: source,
    targetId: target,
    relationshipType: type as GraphEdge["relationshipType"],
    strength: 3,
    quantity: null,
    notes: null,
  };
}

const ISSUE = node({ id: "gate", title: "Trailer gate won't latch", isIssue: true });

describe("issueStateOf", () => {
  it("says nothing about a node that is not an issue", () => {
    const graph: Graph = { nodes: [node({ id: "mulch", title: "Mulch" })], edges: [] };
    expect(issueStateOf(graph, graph.nodes[0])).toBeNull();
  });

  it("is open when nothing is linked as the fix", () => {
    const graph: Graph = { nodes: [ISSUE], edges: [] };
    expect(issueStateOf(graph, ISSUE)).toBe("open");
  });

  it("is answered once a solution is linked but not started", () => {
    const fix = node({ id: "weld", title: "Get the latch welded", status: "planned" });
    const graph: Graph = { nodes: [ISSUE, fix], edges: [edge("gate", "weld")] };
    expect(issueStateOf(graph, ISSUE)).toBe("answered");
  });

  it("is solved once the solution is under way", () => {
    const fix = node({ id: "weld", title: "Get the latch welded", status: "active" });
    const graph: Graph = { nodes: [ISSUE, fix], edges: [edge("gate", "weld")] };
    expect(issueStateOf(graph, ISSUE)).toBe("solved");
  });

  it("is solved once the solution is finished", () => {
    const fix = node({ id: "weld", title: "Welded", status: "completed" });
    const graph: Graph = { nodes: [ISSUE, fix], edges: [edge("gate", "weld")] };
    expect(issueStateOf(graph, ISSUE)).toBe("solved");
  });

  it("counts one done solution among several as solved", () => {
    const a = node({ id: "a", title: "Weld it", status: "idea" });
    const b = node({ id: "b", title: "Replace the trailer", status: "completed" });
    const graph: Graph = { nodes: [ISSUE, a, b], edges: [edge("gate", "a"), edge("gate", "b")] };
    expect(issueStateOf(graph, ISSUE)).toBe("solved");
  });

  it("ignores an ordinary edge — being related is not being solved", () => {
    const other = node({ id: "trailer", title: "Trailer", status: "active" });
    const graph: Graph = { nodes: [ISSUE, other], edges: [edge("gate", "trailer", "related_to")] };
    expect(issueStateOf(graph, ISSUE)).toBe("open");
  });

  it("ignores the edge pointing the wrong way", () => {
    // "The weld is solved by the gate" is not a thing anybody means, and must
    // not quietly mark the gate as fixed.
    const fix = node({ id: "weld", title: "Weld", status: "completed" });
    const graph: Graph = { nodes: [ISSUE, fix], edges: [edge("weld", "gate")] };
    expect(issueStateOf(graph, ISSUE)).toBe("open");
  });

  it("survives an edge pointing at a node that is gone", () => {
    const graph: Graph = { nodes: [ISSUE], edges: [edge("gate", "deleted")] };
    expect(issueStateOf(graph, ISSUE)).toBe("open");
  });
});

describe("solutionsFor", () => {
  it("lists each solution once even if linked twice", () => {
    const fix = node({ id: "weld", title: "Weld" });
    const twice: Graph = {
      nodes: [ISSUE, fix],
      edges: [edge("gate", "weld"), { ...edge("gate", "weld"), id: "second" }],
    };
    expect(solutionsFor(twice, "gate")).toHaveLength(1);
  });
});

describe("issueColorFor", () => {
  it("is red while unsolved", () => {
    const graph: Graph = { nodes: [ISSUE], edges: [] };
    expect(issueColorFor(graph, ISSUE)).toBe(ISSUE_COLORS.open);
  });

  it("goes green once solved", () => {
    const fix = node({ id: "weld", title: "Weld", status: "completed" });
    const graph: Graph = { nodes: [ISSUE, fix], edges: [edge("gate", "weld")] };
    expect(issueColorFor(graph, ISSUE)).toBe(ISSUE_COLORS.solved);
  });

  it("leaves an ordinary node its own colour", () => {
    const mulch = node({ id: "mulch", title: "Mulch" });
    expect(issueColorFor({ nodes: [mulch], edges: [] }, mulch)).toBeNull();
  });
});

describe("listIssues", () => {
  it("puts unsolved first, then planned, then solved", () => {
    const open = node({ id: "o", title: "Open", isIssue: true });
    const planned = node({ id: "p", title: "Planned", isIssue: true });
    const done = node({ id: "d", title: "Done", isIssue: true });
    const fixA = node({ id: "fa", title: "Fix A", status: "idea" });
    const fixB = node({ id: "fb", title: "Fix B", status: "completed" });
    const graph: Graph = {
      nodes: [done, planned, open, fixA, fixB],
      edges: [edge("p", "fa"), edge("d", "fb")],
    };
    expect(listIssues(graph).map((i) => i.node.id)).toEqual(["o", "p", "d"]);
  });

  it("breaks ties on importance, most important first", () => {
    const low = node({ id: "low", title: "Low", isIssue: true, importance: 1 });
    const high = node({ id: "high", title: "High", isIssue: true, importance: 5 });
    const graph: Graph = { nodes: [low, high], edges: [] };
    expect(listIssues(graph).map((i) => i.node.id)).toEqual(["high", "low"]);
  });

  it("leaves out everything that is not an issue", () => {
    const graph: Graph = { nodes: [node({ id: "mulch", title: "Mulch" })], edges: [] };
    expect(listIssues(graph)).toEqual([]);
  });
});

describe("openIssues", () => {
  it("is only the ones still needing an answer", () => {
    const open = node({ id: "o", title: "Open", isIssue: true });
    const done = node({ id: "d", title: "Done", isIssue: true });
    const fix = node({ id: "f", title: "Fix", status: "completed" });
    const graph: Graph = { nodes: [open, done, fix], edges: [edge("d", "f")] };
    expect(openIssues(graph).map((i) => i.node.id)).toEqual(["o"]);
  });
});

describe("canSolve", () => {
  it("allows an ordinary node to fix an issue", () => {
    expect(canSolve(ISSUE, node({ id: "weld", title: "Weld" })).ok).toBe(true);
  });

  it("refuses something solving itself", () => {
    const verdict = canSolve(ISSUE, ISSUE);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/its own solution/);
  });

  it("refuses one problem as the answer to another", () => {
    const other = node({ id: "other", title: "Also broken", isIssue: true });
    const verdict = canSolve(ISSUE, other);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/another problem/);
  });

  it("refuses solving something that is not an issue", () => {
    const mulch = node({ id: "mulch", title: "Mulch" });
    expect(canSolve(mulch, node({ id: "x", title: "X" })).ok).toBe(false);
  });
});

describe("describeIssue", () => {
  it("says nothing is linked while open", () => {
    const graph: Graph = { nodes: [ISSUE], edges: [] };
    expect(describeIssue(listIssues(graph)[0])).toMatch(/nothing linked/);
  });

  it("names the solution once there is one", () => {
    const fix = node({ id: "weld", title: "Get the latch welded", status: "completed" });
    const graph: Graph = { nodes: [ISSUE, fix], edges: [edge("gate", "weld")] };
    expect(describeIssue(listIssues(graph)[0])).toBe("Solved by Get the latch welded.");
  });
});

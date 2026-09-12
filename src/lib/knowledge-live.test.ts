import { describe, expect, it } from "vitest";

import {
  EMPTY_ROWS,
  buildLiveGraph,
  isLive,
  kindOf,
  liveCounts,
  liveId,
  liveSummary,
  mergeLive,
  statusForJob,
  type LiveRows,
} from "./knowledge-live";
import type { GraphEdge, GraphNode } from "./knowledge-graph";

function rows(over: Partial<LiveRows> = {}): LiveRows {
  return {
    ...EMPTY_ROWS,
    customers: [{ id: "c1", name: "Dana Ruiz", contact_type: "client" }],
    properties: [{ id: "p1", customer_id: "c1", address: "12 Oak St" }],
    jobs: [{ id: "j1", name: "Front beds", status: "in_progress", property_id: "p1", job_number: 14 }],
    jobServices: [{ job_id: "j1", service_type_id: "mulch" }],
    services: [{ service_type_id: "mulch", name: "Mulch Install", cost: 45, cost_unit: "yard" }],
    materials: [
      { id: "m1", name: "Hardwood mulch", unit: "yard", cost_per_unit: 32, category: "Mulch" },
    ],
    tools: [{ id: "t1", name: "Wheelbarrow", category: "Hand tools", cost: 120 }],
    serviceMaterials: [{ service_type_id: "mulch", material_id: "m1" }],
    serviceTools: [{ service_type_id: "mulch", tool_id: "t1" }],
    people: [{ id: "u1", name: "Sam" }],
    jobCrew: [{ job_id: "j1", profile_id: "u1" }],
    invoices: [{ id: "i1", job_id: "j1", amount: 1000, status: "paid" }],
    spending: [{ category: "Fuel", total: 240, jobIds: ["j1"] }],
    ...over,
  };
}

function edgeBetween(edges: GraphEdge[], from: string, to: string): GraphEdge | undefined {
  return edges.find((e) => e.sourceId === from && e.targetId === to);
}

describe("liveId and friends", () => {
  it("makes the same node id for the same row every time", () => {
    expect(liveId("job", "j1")).toBe("live:job:j1");
    expect(liveId("job", "j1")).toBe(liveId("job", "j1"));
  });

  it("can tell a derived node from a saved one", () => {
    expect(isLive("live:job:j1")).toBe(true);
    expect(isLive("8f14e45f-ceea-467a-9a36-dedd4bea2543")).toBe(false);
    expect(kindOf("live:material:m1")).toBe("material");
    expect(kindOf("not-live")).toBeNull();
  });
});

describe("statusForJob", () => {
  it("says the same thing the job says, in the graph's words", () => {
    expect(statusForJob("completed")).toBe("completed");
    expect(statusForJob("in_progress")).toBe("active");
    expect(statusForJob("cancelled")).toBe("archived");
    expect(statusForJob("lead")).toBe("planned");
  });

  it("treats a status it has never seen as live work rather than dropping it", () => {
    expect(statusForJob("something_new")).toBe("active");
  });
});

describe("buildLiveGraph", () => {
  it("draws the shape the business actually has", () => {
    const { nodes, edges } = buildLiveGraph(rows());
    const ids = new Set(nodes.map((n) => n.id));

    expect(ids.has("live:customer:c1")).toBe(true);
    expect(ids.has("live:property:p1")).toBe(true);
    expect(ids.has("live:job:j1")).toBe(true);
    expect(ids.has("live:service:mulch")).toBe(true);
    expect(ids.has("live:material:m1")).toBe(true);
    expect(ids.has("live:tool:t1")).toBe(true);
    expect(ids.has("live:invoice:i1")).toBe(true);
    expect(ids.has("live:cost:Fuel")).toBe(true);

    expect(edgeBetween(edges, "live:customer:c1", "live:property:p1")).toBeTruthy();
    expect(edgeBetween(edges, "live:job:j1", "live:property:p1")).toBeTruthy();
    expect(edgeBetween(edges, "live:job:j1", "live:service:mulch")).toBeTruthy();
    expect(edgeBetween(edges, "live:service:mulch", "live:material:m1")?.relationshipType).toBe(
      "requires_material"
    );
    expect(edgeBetween(edges, "live:service:mulch", "live:tool:t1")?.relationshipType).toBe(
      "requires_equipment"
    );
    expect(edgeBetween(edges, "live:job:j1", "live:invoice:i1")?.relationshipType).toBe(
      "generates_revenue"
    );
    expect(edgeBetween(edges, "live:job:j1", "live:cost:Fuel")?.relationshipType).toBe("has_cost");
    expect(edgeBetween(edges, "live:job:j1", "live:person:u1")?.relationshipType).toBe(
      "performed_by"
    );
  });

  it("leaves a contact with nowhere to work out of the picture", () => {
    // A contact book of several hundred names with nothing attached is a wall
    // of dots that buries the handful worth looking at.
    const graph = buildLiveGraph(
      rows({
        customers: [
          { id: "c1", name: "Dana Ruiz", contact_type: "client" },
          { id: "c2", name: "Nobody Yet", contact_type: "lead" },
        ],
      })
    );
    expect(graph.nodes.some((n) => n.id === "live:customer:c2")).toBe(false);
  });

  it("keeps a service nobody has bought, because the business still offers it", () => {
    const graph = buildLiveGraph(rows({ jobServices: [] }));
    const service = graph.nodes.find((n) => n.id === "live:service:mulch");
    expect(service?.status).toBe("planned");
  });

  it("carries the material's real id, so the price is inventory's not a copy", () => {
    const material = buildLiveGraph(rows()).nodes.find((n) => n.id === "live:material:m1");
    expect(material?.materialId).toBe("m1");
    expect(material?.estimatedCost).toBe(32);
  });

  it("opens the screen the row lives on", () => {
    const { nodes } = buildLiveGraph(rows());
    expect(nodes.find((n) => n.id === "live:job:j1")?.appRoute).toBe("/jobs/j1");
    expect(nodes.find((n) => n.id === "live:customer:c1")?.appRoute).toBe("/clients/c1");
  });

  it("names a job by its number so two 'Front beds' are not one dot", () => {
    expect(buildLiveGraph(rows()).nodes.find((n) => n.id === "live:job:j1")?.title).toBe(
      "#14 Front beds"
    );
  });

  it("ignores a link pointing at something that is not there", () => {
    const graph = buildLiveGraph(rows({ serviceMaterials: [{ service_type_id: "mulch", material_id: "gone" }] }));
    expect(graph.edges.some((e) => e.targetId === "live:material:gone")).toBe(false);
  });

  it("draws one line per fact, however many rows said it", () => {
    const graph = buildLiveGraph(
      rows({
        jobCrew: [
          { job_id: "j1", profile_id: "u1" },
          { job_id: "j1", profile_id: "u1" },
        ],
      })
    );
    const crewEdges = graph.edges.filter((e) => e.targetId === "live:person:u1");
    expect(crewEdges).toHaveLength(1);
  });

  it("only draws crew who are actually on a job", () => {
    const graph = buildLiveGraph(
      rows({ people: [{ id: "u1", name: "Sam" }, { id: "u2", name: "Nobody" }] })
    );
    expect(graph.nodes.some((n) => n.id === "live:person:u2")).toBe(false);
  });

  it("returns an empty picture for an empty business rather than throwing", () => {
    expect(buildLiveGraph(EMPTY_ROWS)).toEqual({ nodes: [], edges: [] });
  });
});

describe("mergeLive", () => {
  const savedNode: GraphNode = {
    ...buildLiveGraph(rows()).nodes[0],
    id: "saved-1",
    title: "Mulch (typed by hand)",
    materialId: "m1",
  };

  it("keeps both halves", () => {
    const live = buildLiveGraph(rows());
    const merged = mergeLive({ nodes: [savedNode], edges: [] }, live);
    expect(merged.nodes).toHaveLength(live.nodes.length + 1);
  });

  it("joins a typed node to the inventory row it already points at", () => {
    const live = buildLiveGraph(rows());
    const merged = mergeLive({ nodes: [savedNode], edges: [] }, live);
    expect(edgeBetween(merged.edges, "saved-1", "live:material:m1")).toBeTruthy();
  });

  it("leaves a typed node with no inventory behind it alone", () => {
    const orphan = { ...savedNode, id: "saved-2", materialId: null, toolId: null };
    const merged = mergeLive({ nodes: [orphan], edges: [] }, buildLiveGraph(rows()));
    expect(merged.edges.some((e) => e.sourceId === "saved-2")).toBe(false);
  });
});

describe("liveCounts and liveSummary", () => {
  it("counts what came off the business", () => {
    const counts = liveCounts(buildLiveGraph(rows()).nodes);
    expect(counts.job).toBe(1);
    expect(counts.material).toBe(1);
  });

  it("reads as a sentence, in the singular where it is one", () => {
    const summary = liveSummary(liveCounts(buildLiveGraph(rows()).nodes));
    expect(summary).toContain("1 client");
    expect(summary).toContain("1 job");
    expect(summary).not.toContain("1 jobs");
  });

  it("says plainly when there is nothing yet", () => {
    expect(liveSummary({})).toBe("Nothing on the books yet");
  });
});

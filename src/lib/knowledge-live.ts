/**
 * The business itself, drawn on the same board as the thinking.
 *
 * The graph was a place to decompose ideas by hand. Everything the business
 * actually runs on — the customers, their properties, the jobs on them, the
 * services those jobs sell, the materials and tools those services eat, the
 * money in and the money out — lived in its own tables and appeared nowhere,
 * so the map of the business was a map of what somebody had remembered to
 * type onto it.
 *
 * This derives that half instead of storing it. Nothing here is written back:
 * a node is a view of the row it came from, so adding a customer adds a node,
 * finishing a job moves one, and deleting a material takes one away, with
 * nothing to keep in step and nothing to go stale. Hand-built idea nodes are
 * untouched and sit alongside.
 *
 * Ids are prefixed and deterministic — `live:job:<uuid>` — so the same row is
 * the same node on every load, an edge can be built without a lookup table,
 * and nothing derived can ever collide with a real saved node.
 */

import type { GraphEdge, GraphNode, NodeStatus, NodeType, RelationshipType } from "@/lib/knowledge-graph";

export type LiveKind =
  | "customer"
  | "property"
  | "job"
  | "service"
  | "material"
  | "tool"
  | "person"
  | "invoice"
  | "cost";

export function liveId(kind: LiveKind, id: string): string {
  return `live:${kind}:${id}`;
}

/** Whether a node on the board came from the business rather than somebody's
 * hand. Used to tell them apart without a second field on every node. */
export function isLive(nodeId: string): boolean {
  return nodeId.startsWith("live:");
}

export function kindOf(nodeId: string): LiveKind | null {
  const parts = nodeId.split(":");
  return isLive(nodeId) ? ((parts[1] as LiveKind) ?? null) : null;
}

// ---------------------------------------------------------------------------
// The rows, as this module needs them
// ---------------------------------------------------------------------------

export interface LiveRows {
  customers: { id: string; name: string; contact_type: string | null }[];
  properties: { id: string; customer_id: string; address: string }[];
  jobs: {
    id: string;
    name: string;
    status: string;
    property_id: string;
    job_number: number | null;
  }[];
  /** Which services each job asked for. */
  jobServices: { job_id: string; service_type_id: string }[];
  services: { service_type_id: string; name: string; cost: number | null; cost_unit: string }[];
  materials: {
    id: string;
    name: string;
    unit: string;
    cost_per_unit: number | null;
    category: string;
  }[];
  tools: { id: string; name: string; category: string; cost: number | null }[];
  serviceMaterials: { service_type_id: string; material_id: string }[];
  serviceTools: { service_type_id: string; tool_id: string }[];
  people: { id: string; name: string }[];
  jobCrew: { job_id: string; profile_id: string }[];
  invoices: { id: string; job_id: string; amount: number; status: string }[];
  /** Money out, already grouped by what it was for. */
  spending: { category: string; total: number; jobIds: string[] }[];
}

export const EMPTY_ROWS: LiveRows = {
  customers: [],
  properties: [],
  jobs: [],
  jobServices: [],
  services: [],
  materials: [],
  tools: [],
  serviceMaterials: [],
  serviceTools: [],
  people: [],
  jobCrew: [],
  invoices: [],
  spending: [],
};

// ---------------------------------------------------------------------------
// Building the nodes
// ---------------------------------------------------------------------------

/** Everything a derived node does not have. Written once rather than at nine
 * call sites, so a new field on GraphNode is one edit here. */
function base(input: {
  id: string;
  title: string;
  nodeType: NodeType;
  status: NodeStatus;
  description?: string | null;
  appRoute?: string | null;
  estimatedCost?: number | null;
  unit?: string;
  materialId?: string | null;
  toolId?: string | null;
  tags?: string[];
}): GraphNode {
  return {
    id: input.id,
    title: input.title,
    nodeType: input.nodeType,
    status: input.status,
    isIssue: false,
    imagePath: null,
    description: input.description ?? null,
    importance: null,
    estimatedCost: input.estimatedCost ?? null,
    unit: input.unit ?? "each",
    purchaseUrl: null,
    appRoute: input.appRoute ?? null,
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
    materialId: input.materialId ?? null,
    toolId: input.toolId ?? null,
    materialName: null,
    stockOnHand: null,
    reorderThreshold: null,
    onOrder: false,
    potentialValue: null,
    notes: null,
    tags: input.tags ?? [],
    positionX: null,
    positionY: null,
  } as GraphNode;
}

/**
 * A job's status, said in the graph's own words.
 *
 * The two vocabularies nearly line up, which is exactly why they need
 * mapping rather than casting: "completed" means the same in both and
 * "approved" means nothing to the graph at all.
 */
export function statusForJob(jobStatus: string): NodeStatus {
  switch (jobStatus) {
    case "completed":
      return "completed";
    case "cancelled":
      return "archived";
    case "in_progress":
      return "active";
    case "lead":
    case "estimating":
      return "planned";
    default:
      return "active";
  }
}

function edge(
  sourceId: string,
  targetId: string,
  relationshipType: RelationshipType
): GraphEdge {
  return {
    id: `live:${sourceId}->${targetId}:${relationshipType}`,
    sourceId,
    targetId,
    relationshipType,
    // Full strength: this is not somebody's guess about a connection, it is
    // a row saying the connection exists.
    strength: 1,
    quantity: null,
    stepOrder: null,
    notes: null,
  };
}

/**
 * The business as nodes and edges.
 *
 * The shape it draws is the shape the business actually has: a person owns a
 * property, a property has jobs on it, a job sells services, a service eats
 * materials and needs tools, a job bills an invoice and costs money out. Every
 * one of those is a row somebody already keeps — the graph just stops being
 * the only place they are not connected.
 */
export function buildLiveGraph(rows: LiveRows): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // Only customers with somewhere to put a job on. A contact book of several
  // hundred names with nothing attached is a wall of dots that buries the
  // handful of things worth looking at.
  const propertiesByCustomer = new Map<string, typeof rows.properties>();
  for (const property of rows.properties) {
    const list = propertiesByCustomer.get(property.customer_id) ?? [];
    list.push(property);
    propertiesByCustomer.set(property.customer_id, list);
  }

  for (const customer of rows.customers) {
    const owned = propertiesByCustomer.get(customer.id) ?? [];
    if (owned.length === 0) continue;

    const customerNode = liveId("customer", customer.id);
    nodes.push(
      base({
        id: customerNode,
        title: customer.name,
        nodeType: "person",
        status: "active",
        description: `${owned.length} ${owned.length === 1 ? "property" : "properties"}`,
        appRoute: `/clients/${customer.id}`,
        tags: [customer.contact_type ?? "client"],
      })
    );

    for (const property of owned) {
      const propertyNode = liveId("property", property.id);
      nodes.push(
        base({
          id: propertyNode,
          title: property.address,
          nodeType: "location",
          status: "active",
          tags: ["property"],
        })
      );
      edges.push(edge(customerNode, propertyNode, "located_at"));
    }
  }

  const servicesById = new Map(rows.services.map((s) => [s.service_type_id, s]));
  const usedServiceIds = new Set<string>();

  const propertyIds = new Set(rows.properties.map((p) => p.id));
  for (const job of rows.jobs) {
    const jobNode = liveId("job", job.id);
    nodes.push(
      base({
        id: jobNode,
        title: job.job_number ? `#${job.job_number} ${job.name}` : job.name,
        nodeType: "task",
        status: statusForJob(job.status),
        description: job.status.replace(/_/g, " "),
        appRoute: `/jobs/${job.id}`,
        tags: ["job"],
      })
    );
    if (propertyIds.has(job.property_id)) {
      edges.push(edge(jobNode, liveId("property", job.property_id), "located_at"));
    }
  }

  const jobIds = new Set(rows.jobs.map((j) => j.id));
  for (const link of rows.jobServices) {
    if (!jobIds.has(link.job_id) || !servicesById.has(link.service_type_id)) continue;
    usedServiceIds.add(link.service_type_id);
    edges.push(edge(liveId("job", link.job_id), liveId("service", link.service_type_id), "uses"));
  }

  // Every service on the rate card, not only the sold ones: a service nobody
  // has bought yet is a thing the business offers, and its absence from the
  // map is the kind of gap this is for.
  for (const service of rows.services) {
    nodes.push(
      base({
        id: liveId("service", service.service_type_id),
        title: service.name,
        nodeType: "service",
        status: usedServiceIds.has(service.service_type_id) ? "active" : "planned",
        estimatedCost: service.cost,
        unit: service.cost_unit || "each",
        appRoute: "/admin/tools",
        tags: ["service"],
      })
    );
  }

  for (const material of rows.materials) {
    nodes.push(
      base({
        id: liveId("material", material.id),
        title: material.name,
        nodeType: "material",
        status: "active",
        estimatedCost: material.cost_per_unit,
        unit: material.unit || "each",
        // Linked to the real row, so the price on the board is the price in
        // inventory rather than a second copy of it.
        materialId: material.id,
        appRoute: "/admin/tools",
        tags: [material.category || "material"],
      })
    );
  }

  for (const tool of rows.tools) {
    nodes.push(
      base({
        id: liveId("tool", tool.id),
        title: tool.name,
        nodeType: "tool",
        status: "active",
        estimatedCost: tool.cost,
        toolId: tool.id,
        appRoute: "/admin/tools",
        tags: [tool.category || "tool"],
      })
    );
  }

  const materialIds = new Set(rows.materials.map((m) => m.id));
  for (const link of rows.serviceMaterials) {
    if (!servicesById.has(link.service_type_id) || !materialIds.has(link.material_id)) continue;
    edges.push(
      edge(
        liveId("service", link.service_type_id),
        liveId("material", link.material_id),
        "requires_material"
      )
    );
  }

  const toolIds = new Set(rows.tools.map((t) => t.id));
  for (const link of rows.serviceTools) {
    if (!servicesById.has(link.service_type_id) || !toolIds.has(link.tool_id)) continue;
    edges.push(
      edge(liveId("service", link.service_type_id), liveId("tool", link.tool_id), "requires_equipment")
    );
  }

  const peopleOnJobs = new Set(rows.jobCrew.map((c) => c.profile_id));
  for (const person of rows.people) {
    if (!peopleOnJobs.has(person.id)) continue;
    nodes.push(
      base({
        id: liveId("person", person.id),
        title: person.name,
        nodeType: "person",
        status: "active",
        tags: ["crew"],
      })
    );
  }
  for (const link of rows.jobCrew) {
    if (!jobIds.has(link.job_id) || !peopleOnJobs.has(link.profile_id)) continue;
    edges.push(edge(liveId("job", link.job_id), liveId("person", link.profile_id), "performed_by"));
  }

  for (const invoice of rows.invoices) {
    if (!jobIds.has(invoice.job_id)) continue;
    const invoiceNode = liveId("invoice", invoice.id);
    nodes.push(
      base({
        id: invoiceNode,
        title: `${invoice.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })} invoice`,
        nodeType: "revenue_source",
        status: invoice.status === "paid" ? "completed" : "active",
        description: invoice.status,
        appRoute: "/admin/payments",
        tags: ["invoice", invoice.status],
      })
    );
    edges.push(edge(liveId("job", invoice.job_id), invoiceNode, "generates_revenue"));
  }

  // Money out, grouped by what it was for. One node per category rather than
  // per receipt: a board with four hundred fuel receipts on it is a board
  // nobody can read, and "fuel" is the thing anybody would act on anyway.
  for (const spend of rows.spending) {
    const costNode = liveId("cost", spend.category);
    nodes.push(
      base({
        id: costNode,
        title: spend.category,
        nodeType: "cost",
        status: "active",
        description: `${spend.total.toLocaleString("en-US", { style: "currency", currency: "USD" })} out`,
        estimatedCost: spend.total,
        appRoute: "/admin/payments",
        tags: ["spending"],
      })
    );
    for (const jobId of spend.jobIds) {
      if (jobIds.has(jobId)) edges.push(edge(liveId("job", jobId), costNode, "has_cost"));
    }
  }

  return { nodes, edges: dedupeEdges(edges) };
}

/** The same pair can be produced twice — a job crewed by somebody on two
 * visits, a service using a material in two rules. One line is the fact. */
function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  const out: GraphEdge[] = [];
  for (const item of edges) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * The hand-built graph with the business laid over it.
 *
 * A saved node linked to a material already carries that material's price;
 * the derived material node is the same thing from the other direction. They
 * are joined rather than left as twins, so the printer somebody typed and the
 * cardstock in inventory end up as one picture.
 */
export function mergeLive(
  saved: { nodes: GraphNode[]; edges: GraphEdge[] },
  live: { nodes: GraphNode[]; edges: GraphEdge[] }
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes = [...saved.nodes, ...live.nodes];
  const edges = [...saved.edges, ...live.edges];

  const liveByMaterial = new Map<string, string>();
  const liveByTool = new Map<string, string>();
  for (const node of live.nodes) {
    if (node.materialId) liveByMaterial.set(node.materialId, node.id);
    if (node.toolId) liveByTool.set(node.toolId, node.id);
  }

  for (const node of saved.nodes) {
    const twin =
      (node.materialId && liveByMaterial.get(node.materialId)) ||
      (node.toolId && liveByTool.get(node.toolId)) ||
      null;
    if (twin && twin !== node.id) {
      edges.push(edge(node.id, twin, "related_to"));
    }
  }

  return { nodes, edges: dedupeEdges(edges) };
}

/** How many of each kind came off the business, for the toggle's label. */
export function liveCounts(nodes: GraphNode[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of nodes) {
    const kind = kindOf(node.id);
    if (!kind) continue;
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

/** The one-line summary under the toggle. */
export function liveSummary(counts: Record<string, number>): string {
  const order: LiveKind[] = [
    "customer",
    "property",
    "job",
    "service",
    "material",
    "tool",
    "person",
    "invoice",
    "cost",
  ];
  const words: Record<LiveKind, [string, string]> = {
    customer: ["client", "clients"],
    property: ["property", "properties"],
    job: ["job", "jobs"],
    service: ["service", "services"],
    material: ["material", "materials"],
    tool: ["tool", "tools"],
    person: ["crew member", "crew"],
    invoice: ["invoice", "invoices"],
    cost: ["cost", "costs"],
  };

  const parts: string[] = [];
  for (const kind of order) {
    const count = counts[kind] ?? 0;
    if (count === 0) continue;
    parts.push(`${count} ${words[kind][count === 1 ? 0 : 1]}`);
  }
  return parts.length === 0 ? "Nothing on the books yet" : parts.join(", ");
}

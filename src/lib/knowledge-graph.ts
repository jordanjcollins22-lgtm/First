/**
 * Ideas, broken down until they stop being ideas.
 *
 * The point is not storing thoughts. It is decomposing them far enough to
 * reach the paper and the printer — because two ideas that look unrelated
 * usually are not, and nobody notices until something draws the line. Door
 * hangers and flyers are the same cardstock, the same toner and the same
 * afternoon of somebody's design time, and seeing that is what turns "seven
 * marketing ideas" into "one printer".
 *
 * So a node is deliberately not always an idea. An idea that decomposes only
 * into more ideas has not been decomposed.
 */

// Type-only, so the two modules can reference each other without a runtime
// import cycle.
import type { Recurrence } from "@/lib/knowledge-schedule";

export type NodeType =
  | "idea" | "material" | "equipment" | "tool" | "machine" | "software" | "person"
  | "role" | "skill" | "process" | "task" | "location" | "supplier" | "customer_type"
  | "marketing_channel" | "distribution_method" | "cost" | "revenue_source"
  | "product" | "service" | "principle" | "constraint" | "dependency" | "asset"
  | "information" | "other";

export type NodeStatus = "idea" | "researching" | "planned" | "active" | "completed" | "archived";

export interface NodeTypeDef {
  value: NodeType;
  label: string;
  color: string;
  /** Grouped so a picker of twenty-six is a picker of five short lists. */
  group: "Thinking" | "Physical" | "People" | "Doing" | "Money" | "Reach";
}

/**
 * Colours chosen to be told apart as small dots on a dark field, not to look
 * pleasant in a legend. Ideas are deliberately the brightest: on a graph of
 * two hundred nodes, the things somebody wants to act on should be the things
 * the eye lands on.
 */
export const NODE_TYPES: NodeTypeDef[] = [
  { value: "idea", label: "Idea", color: "#facc15", group: "Thinking" },
  { value: "principle", label: "Principle", color: "#a3e635", group: "Thinking" },
  { value: "constraint", label: "Constraint", color: "#f87171", group: "Thinking" },
  { value: "dependency", label: "Dependency", color: "#fb923c", group: "Thinking" },
  { value: "information", label: "Information", color: "#94a3b8", group: "Thinking" },

  { value: "material", label: "Material", color: "#38bdf8", group: "Physical" },
  { value: "equipment", label: "Equipment", color: "#0ea5e9", group: "Physical" },
  { value: "tool", label: "Tool", color: "#22d3ee", group: "Physical" },
  { value: "machine", label: "Machine", color: "#0891b2", group: "Physical" },
  { value: "asset", label: "Asset", color: "#2dd4bf", group: "Physical" },
  { value: "location", label: "Location", color: "#14b8a6", group: "Physical" },
  { value: "software", label: "Software", color: "#818cf8", group: "Physical" },

  { value: "person", label: "Person", color: "#e879f9", group: "People" },
  { value: "role", label: "Role", color: "#c084fc", group: "People" },
  { value: "skill", label: "Skill", color: "#a78bfa", group: "People" },
  { value: "supplier", label: "Supplier", color: "#f472b6", group: "People" },
  { value: "customer_type", label: "Customer type", color: "#fb7185", group: "People" },

  { value: "process", label: "Process", color: "#4ade80", group: "Doing" },
  { value: "task", label: "Task", color: "#34d399", group: "Doing" },
  { value: "product", label: "Product", color: "#10b981", group: "Doing" },
  { value: "service", label: "Service", color: "#059669", group: "Doing" },

  { value: "cost", label: "Cost", color: "#ef4444", group: "Money" },
  { value: "revenue_source", label: "Revenue source", color: "#16a34a", group: "Money" },

  { value: "marketing_channel", label: "Marketing channel", color: "#f59e0b", group: "Reach" },
  { value: "distribution_method", label: "Distribution", color: "#d97706", group: "Reach" },

  { value: "other", label: "Other", color: "#9ca3af", group: "Thinking" },
];

const TYPE_BY_VALUE = new Map(NODE_TYPES.map((t) => [t.value, t]));

export function nodeTypeDef(value: string): NodeTypeDef {
  return TYPE_BY_VALUE.get(value as NodeType) ?? TYPE_BY_VALUE.get("other")!;
}

export const NODE_STATUSES: { value: NodeStatus; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "researching", label: "Researching" },
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];

export type RelationshipType =
  | "uses" | "requires" | "produces" | "depends_on" | "similar_to" | "shares_resource_with"
  | "can_be_combined_with" | "enables" | "replaces" | "leads_to" | "sold_through"
  | "purchased_from" | "performed_by" | "used_by" | "located_at" | "requires_skill"
  | "requires_equipment" | "requires_material" | "has_cost" | "generates_revenue"
  | "part_of" | "parent_of" | "child_of" | "related_to";

export interface RelationshipDef {
  value: RelationshipType;
  label: string;
  /** How it reads coming back the other way, so the panel can say "used by"
   * on the printer's side of "flyers uses printer" without storing it twice. */
  inverse: string;
  /** A relationship that means the same thing both ways is drawn without an
   * arrowhead — an arrow on "similar to" claims a direction that is not there. */
  directional: boolean;
  /**
   * True where the thing flows the opposite way to how the sentence is
   * stored.
   *
   * "Job has cost fuel" is stored job → fuel because that is the order the
   * words go in, but the fuel goes into the job, and an arrow pointing from
   * the job at the fuel is telling somebody the opposite of what happens.
   * These get their arrowhead at the other end.
   */
  flowReversed?: boolean;
}

export const RELATIONSHIP_TYPES: RelationshipDef[] = [
  { value: "uses", label: "uses", inverse: "used by", directional: true },
  { value: "requires", label: "requires", inverse: "required by", directional: true },
  { value: "requires_material", label: "requires material", inverse: "material for", directional: true },
  { value: "requires_equipment", label: "requires equipment", inverse: "equipment for", directional: true },
  { value: "requires_skill", label: "requires skill", inverse: "skill for", directional: true },
  { value: "produces", label: "produces", inverse: "produced by", directional: true },
  { value: "depends_on", label: "depends on", inverse: "depended on by", directional: true },
  { value: "enables", label: "enables", inverse: "enabled by", directional: true },
  { value: "replaces", label: "replaces", inverse: "replaced by", directional: true },
  { value: "leads_to", label: "leads to", inverse: "led to by", directional: true },
  { value: "sold_through", label: "sold through", inverse: "sells", directional: true },
  { value: "purchased_from", label: "purchased from", inverse: "supplies", directional: true, flowReversed: true },
  { value: "performed_by", label: "performed by", inverse: "performs", directional: true, flowReversed: true },
  { value: "used_by", label: "used by", inverse: "uses", directional: true },
  { value: "located_at", label: "located at", inverse: "location of", directional: true },
  { value: "has_cost", label: "has cost", inverse: "cost of", directional: true, flowReversed: true },
  { value: "generates_revenue", label: "generates revenue", inverse: "revenue from", directional: true },
  { value: "part_of", label: "part of", inverse: "contains", directional: true },
  { value: "parent_of", label: "parent of", inverse: "child of", directional: true },
  { value: "child_of", label: "child of", inverse: "parent of", directional: true, flowReversed: true },
  { value: "similar_to", label: "similar to", inverse: "similar to", directional: false },
  { value: "shares_resource_with", label: "shares a resource with", inverse: "shares a resource with", directional: false },
  { value: "can_be_combined_with", label: "can be combined with", inverse: "can be combined with", directional: false },
  { value: "related_to", label: "related to", inverse: "related to", directional: false },
];

const REL_BY_VALUE = new Map(RELATIONSHIP_TYPES.map((r) => [r.value, r]));

export function relationshipDef(value: string): RelationshipDef {
  return REL_BY_VALUE.get(value as RelationshipType) ?? REL_BY_VALUE.get("related_to")!;
}

export interface GraphNode {
  id: string;
  title: string;
  nodeType: NodeType;
  status: NodeStatus;
  description: string | null;
  importance: number | null;
  /** What one unit costs — one sheet, one hour, one bag. Where the node is
   * linked to an inventory material this is the material's price, not a
   * second copy of it. */
  estimatedCost: number | null;
  unit: string;
  /** Where you buy it. */
  purchaseUrl: string | null;
  /**
   * Whether it gets bought again every run, or once and kept.
   *
   * Null means nobody has said and the kind of thing it is decides — which is
   * right most of the time and wrong exactly where it costs money.
   */
  costBasis: "consumable" | "capital" | null;
  /**
   * Hours in one unit, where the unit is a stretch of somebody's day.
   *
   * Resolved when the graph loads, from the built-in units or the ones this
   * business typed itself — so the cost functions never need a registry of
   * every unit anybody has ever invented.
   */
  unitHours: number | null;
  /** How much one unit of it does: 100 sq ft to a bag, 1 hanger to a sheet. */
  outputPerUnit: number | null;
  outputUnit: string | null;
  /** For an idea: how much one run of it produces. */
  runSize: number | null;
  runUnit: string | null;
  /** A flat price charged once per use rather than per unit — a
   * subcontractor, a permit, a delivery fee. */
  fixedCost: number | null;
  /** The real thing in inventory, where this node is one. A node links to a
   * material or a tool, never both. */
  materialId: string | null;
  toolId: string | null;
  /** What it is called in inventory, whichever list it came from. */
  materialName: string | null;
  stockOnHand: number | null;
  reorderThreshold: number | null;
  onOrder: boolean;
  potentialValue: number | null;
  notes: string | null;
  tags: string[];
  positionX: number | null;
  positionY: number | null;
  /** When this is next meant to happen. Null is a perfectly good answer for
   * an idea; a date is what turns it into work. */
  scheduledFor: string | null;
  recurrence: Recurrence;
  recurrenceInterval: number;
  lastDoneAt: string | null;
  timesDone: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GraphEdge {
  id: string;
  /** Where this comes in the sequence, counting from 1. Null means it is part
   * of the thing rather than a step in it. */
  stepOrder?: number | null;
  sourceId: string;
  targetId: string;
  relationshipType: RelationshipType;
  strength: number;
  /** How many units of the target this needs. Null means nobody has said. */
  quantity: number | null;
  notes: string | null;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** How many edges touch each node, either way. Drives node size: the printer
 * everything depends on should be the biggest thing on the screen. */
export function degreeMap(graph: Graph): Map<string, number> {
  const degrees = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
  for (const edge of graph.edges) {
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) ?? 0) + 1);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) ?? 0) + 1);
  }
  return degrees;
}

export interface Neighbour {
  node: GraphNode;
  edge: GraphEdge;
  /** True when this node is the target — the edge points away from the one
   * being inspected. */
  outgoing: boolean;
}

/**
 * Everything one hop from a node, both directions.
 *
 * Both directions is the whole feature. "What does the flyer need" is useful;
 * "what needs the printer" is the question that finds an asset worth buying,
 * and it is only answerable by walking the edges backwards.
 */
export function neighboursOf(graph: Graph, nodeId: string): Neighbour[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out: Neighbour[] = [];

  for (const edge of graph.edges) {
    if (edge.sourceId === nodeId) {
      const node = byId.get(edge.targetId);
      if (node) out.push({ node, edge, outgoing: true });
    } else if (edge.targetId === nodeId) {
      const node = byId.get(edge.sourceId);
      if (node) out.push({ node, edge, outgoing: false });
    }
  }

  return out;
}

/**
 * The neighbourhood around a node, out to a given number of hops.
 *
 * One hop answers "what touches this". Two answers "what else is in the same
 * story" — the flyers that share the printer that this idea needs — which is
 * where the connections nobody had noticed actually live.
 */
export function localGraph(graph: Graph, nodeId: string, depth = 1): Graph {
  const keep = new Set<string>([nodeId]);
  let frontier = [nodeId];

  for (let hop = 0; hop < depth; hop++) {
    const next: string[] = [];
    for (const edge of graph.edges) {
      if (frontier.includes(edge.sourceId) && !keep.has(edge.targetId)) {
        keep.add(edge.targetId);
        next.push(edge.targetId);
      }
      if (frontier.includes(edge.targetId) && !keep.has(edge.sourceId)) {
        keep.add(edge.sourceId);
        next.push(edge.sourceId);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.sourceId) && keep.has(e.targetId)),
  };
}

/** Nodes nothing connects to. Worth being able to hide — a graph of orphans is
 * a list, and worth being able to show, because an orphan is usually a thought
 * somebody never finished. */
export function isolatedNodes(graph: Graph): GraphNode[] {
  const degrees = degreeMap(graph);
  return graph.nodes.filter((n) => (degrees.get(n.id) ?? 0) === 0);
}

/** Loose match for the duplicate check. Punctuation and plurals are how the
 * same printer gets entered three times. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/s$/, "");
}

/**
 * Nodes that might already be the thing somebody is about to create.
 *
 * The graph is worth more when two ideas point at one printer than when it
 * holds two printers, so this runs before anything is added rather than as a
 * tidy-up afterwards.
 */
export function findSimilarNodes(nodes: GraphNode[], title: string, limit = 5): GraphNode[] {
  const needle = normaliseTitle(title);
  if (needle.length < 2) return [];

  return nodes
    .map((node) => {
      const hay = normaliseTitle(node.title);
      if (hay === needle) return { node, score: 3 };
      if (hay.includes(needle) || needle.includes(hay)) return { node, score: 2 };
      // A shared word is a weak signal but catches "laser printer" against
      // "printer", which is exactly the case that matters.
      const words = new Set(needle.split(" "));
      const overlap = hay.split(" ").filter((w) => w.length > 2 && words.has(w)).length;
      return { node, score: overlap > 0 ? 1 : 0 };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || a.node.title.localeCompare(b.node.title))
    .slice(0, limit)
    .map((m) => m.node);
}

export interface GraphFilters {
  search: string;
  nodeTypes: Set<string>;
  statuses: Set<string>;
  relationshipTypes: Set<string>;
  showIsolated: boolean;
  minConnections: number;
  /** Only things with a date on them. What is actually happening, rather than
   * everything anybody ever thought of. */
  scheduledOnly: boolean;
}

export const EMPTY_FILTERS: GraphFilters = {
  search: "",
  nodeTypes: new Set(),
  statuses: new Set(),
  relationshipTypes: new Set(),
  showIsolated: true,
  minConnections: 0,
  scheduledOnly: false,
};

/**
 * The graph somebody is actually looking at.
 *
 * A search keeps the matches and everything one hop from them, rather than the
 * matches alone. Searching "printer" and being shown one lonely dot answers a
 * question nobody asked — the useful answer is the printer surrounded by
 * everything that uses it.
 */
export function applyFilters(graph: Graph, filters: GraphFilters): Graph {
  let nodes = graph.nodes;

  if (filters.nodeTypes.size > 0) nodes = nodes.filter((n) => filters.nodeTypes.has(n.nodeType));
  if (filters.statuses.size > 0) nodes = nodes.filter((n) => filters.statuses.has(n.status));
  if (filters.scheduledOnly) nodes = nodes.filter((n) => n.scheduledFor != null);

  let edges = graph.edges;
  if (filters.relationshipTypes.size > 0) {
    edges = edges.filter((e) => filters.relationshipTypes.has(e.relationshipType));
  }

  const needle = filters.search.trim().toLowerCase();
  if (needle) {
    const matched = new Set(
      nodes
        .filter(
          (n) =>
            n.title.toLowerCase().includes(needle) ||
            (n.description ?? "").toLowerCase().includes(needle) ||
            n.tags.some((t) => t.toLowerCase().includes(needle))
        )
        .map((n) => n.id)
    );
    const keep = new Set(matched);
    for (const edge of edges) {
      if (matched.has(edge.sourceId)) keep.add(edge.targetId);
      if (matched.has(edge.targetId)) keep.add(edge.sourceId);
    }
    nodes = nodes.filter((n) => keep.has(n.id));
  }

  const visible = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => visible.has(e.sourceId) && visible.has(e.targetId));

  if (filters.minConnections > 0 || !filters.showIsolated) {
    const degrees = degreeMap({ nodes, edges });
    const floor = Math.max(filters.minConnections, filters.showIsolated ? 0 : 1);
    nodes = nodes.filter((n) => (degrees.get(n.id) ?? 0) >= floor);
    const stillVisible = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => stillVisible.has(e.sourceId) && stillVisible.has(e.targetId));
  }

  return { nodes, edges };
}

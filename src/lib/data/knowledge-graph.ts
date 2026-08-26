import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { Graph, GraphEdge, GraphNode, NodeStatus, NodeType, RelationshipType } from "@/lib/knowledge-graph";
import type { Recurrence } from "@/lib/knowledge-schedule";

export interface KnowledgeGraphData extends Graph {
  /** Every tag in use, for the filter list. */
  tags: string[];
  setupNeeded: boolean;
}

const EMPTY: KnowledgeGraphData = { nodes: [], edges: [], tags: [], setupNeeded: true };

/**
 * The whole graph.
 *
 * Loaded in one go rather than paged, because a graph is only meaningful
 * whole — half a graph draws edges to nodes that are not there, and the
 * connections nobody had noticed are exactly the ones a page boundary would
 * cut through. If this ever grows past what a phone can hold, the answer is
 * loading a neighbourhood rather than loading half.
 */
export async function getKnowledgeGraph(): Promise<KnowledgeGraphData> {
  const supabase = await createClient();

  const [nodeRes, edgeRes, tagRes] = await Promise.all([
    supabase
      .from("knowledge_nodes")
      .select(
        "id, title, description, node_type, status, importance, estimated_cost, unit, potential_value, notes, position_x, position_y, scheduled_for, recurrence, recurrence_interval, last_done_at, times_done, created_by, created_at, updated_at"
      )
      .order("created_at"),
    supabase
      .from("knowledge_relationships")
      .select("id, source_node_id, target_node_id, relationship_type, strength, quantity, notes"),
    supabase.from("knowledge_node_tags").select("node_id, knowledge_tags(name)"),
  ]);

  if (isMissingTable(nodeRes.error)) return EMPTY;
  if (nodeRes.error) throw nodeRes.error;

  const tagsByNode = new Map<string, string[]>();
  const allTags = new Set<string>();
  for (const row of (tagRes.data ?? []) as unknown as {
    node_id: string;
    knowledge_tags: { name: string } | null;
  }[]) {
    const name = row.knowledge_tags?.name;
    if (!name) continue;
    allTags.add(name);
    const list = tagsByNode.get(row.node_id) ?? [];
    list.push(name);
    tagsByNode.set(row.node_id, list);
  }

  const nodes: GraphNode[] = (
    (nodeRes.data ?? []) as unknown as {
      id: string;
      title: string;
      description: string | null;
      node_type: string;
      status: string;
      importance: number | null;
      estimated_cost: number | null;
      unit: string | null;
      potential_value: number | null;
      notes: string | null;
      position_x: number | null;
      position_y: number | null;
      scheduled_for: string | null;
      recurrence: string | null;
      recurrence_interval: number | null;
      last_done_at: string | null;
      times_done: number | null;
      created_by: string | null;
      created_at: string;
      updated_at: string;
    }[]
  ).map((n) => ({
    id: n.id,
    title: n.title,
    description: n.description,
    nodeType: n.node_type as NodeType,
    status: n.status as NodeStatus,
    importance: n.importance,
    estimatedCost: n.estimated_cost != null ? Number(n.estimated_cost) : null,
    unit: n.unit ?? "each",
    potentialValue: n.potential_value != null ? Number(n.potential_value) : null,
    notes: n.notes,
    tags: tagsByNode.get(n.id) ?? [],
    positionX: n.position_x,
    positionY: n.position_y,
    scheduledFor: n.scheduled_for,
    recurrence: (n.recurrence ?? "none") as Recurrence,
    recurrenceInterval: n.recurrence_interval ?? 1,
    lastDoneAt: n.last_done_at,
    timesDone: n.times_done ?? 0,
    createdBy: n.created_by,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
  }));

  const edges: GraphEdge[] = (
    (edgeRes.data ?? []) as unknown as {
      id: string;
      source_node_id: string;
      target_node_id: string;
      relationship_type: string;
      strength: number;
      quantity: number | null;
      notes: string | null;
    }[]
  ).map((e) => ({
    id: e.id,
    sourceId: e.source_node_id,
    targetId: e.target_node_id,
    relationshipType: e.relationship_type as RelationshipType,
    strength: e.strength,
    quantity: e.quantity != null ? Number(e.quantity) : null,
    notes: e.notes,
  }));

  return { nodes, edges, tags: [...allTags].sort(), setupNeeded: false };
}

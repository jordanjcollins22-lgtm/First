import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { Graph, GraphEdge, GraphNode, NodeStatus, NodeType, RelationshipType } from "@/lib/knowledge-graph";
import type { Recurrence } from "@/lib/knowledge-schedule";
import { UNITS } from "@/lib/knowledge-cost";

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
        "id, title, description, node_type, status, importance, unit, purchase_url, material_id, potential_value, notes, position_x, position_y, scheduled_for, recurrence, recurrence_interval, last_done_at, times_done, created_by, created_at, updated_at"
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

  /**
   * The real materials behind any node that is linked to one.
   *
   * Fetched separately rather than joined so that a node whose material has
   * been deleted still loads — a broken link should cost the link, not the
   * whole graph. Where a link resolves, the material's price wins: the point
   * of linking is that there is one price, in the place the rest of the
   * business already keeps it.
   */
  const materialIds = [
    ...new Set(
      ((nodeRes.data ?? []) as unknown as { material_id: string | null }[])
        .map((n) => n.material_id)
        .filter((id): id is string => id != null)
    ),
  ];

  const materials = new Map<string, MaterialLink>();
  if (materialIds.length > 0) {
    const { data: materialRows } = await supabase
      .from("materials")
      .select("id, name, cost_per_unit, unit, purchase_url, quantity_on_hand, reorder_threshold, on_order")
      .in("id", materialIds);

    for (const row of (materialRows ?? []) as unknown as MaterialRow[]) {
      materials.set(row.id, {
        name: row.name,
        costPerUnit: row.cost_per_unit != null ? Number(row.cost_per_unit) : null,
        unit: row.unit,
        purchaseUrl: row.purchase_url,
        stockOnHand: row.quantity_on_hand != null ? Number(row.quantity_on_hand) : null,
        reorderThreshold: row.reorder_threshold != null ? Number(row.reorder_threshold) : null,
        onOrder: row.on_order ?? false,
      });
    }
  }

  const nodes: GraphNode[] = (
    (nodeRes.data ?? []) as unknown as {
      id: string;
      title: string;
      description: string | null;
      node_type: string;
      status: string;
      importance: number | null;
      unit: string | null;
      purchase_url: string | null;
      material_id: string | null;
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
  ).map((n) => {
    const material = n.material_id ? materials.get(n.material_id) : undefined;
    return {
    id: n.id,
    title: n.title,
    description: n.description,
    nodeType: n.node_type as NodeType,
    status: n.status as NodeStatus,
    importance: n.importance,
    // Only ever the real price of the real thing. A number somebody typed
    // into the graph is a guess that outlives whatever it was guessing about,
    // and two prices for one material is worse than one price and a gap.
    estimatedCost: material?.costPerUnit ?? null,
    unit: material ? normaliseUnit(material.unit, n.unit) : n.unit ?? "each",
    purchaseUrl: material?.purchaseUrl ?? n.purchase_url,
    materialId: n.material_id,
    materialName: material?.name ?? null,
    stockOnHand: material?.stockOnHand ?? null,
    reorderThreshold: material?.reorderThreshold ?? null,
    onOrder: material?.onOrder ?? false,
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
    };
  });

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

interface MaterialRow {
  id: string;
  name: string;
  cost_per_unit: number | null;
  unit: string;
  purchase_url: string | null;
  quantity_on_hand: number | null;
  reorder_threshold: number | null;
  on_order: boolean | null;
}

interface MaterialLink {
  name: string;
  costPerUnit: number | null;
  unit: string;
  purchaseUrl: string | null;
  stockOnHand: number | null;
  reorderThreshold: number | null;
  onOrder: boolean;
}

/**
 * A material's unit, where the graph knows what it means.
 *
 * Inventory units are free text and predate this feature, so "bag" lines up
 * and "50lb bag" does not. Rather than guess, an unrecognised one falls back
 * to whatever the node already said — the price is the part that must come
 * from the material, and inventing a unit to match it would be worse than
 * keeping the one somebody chose.
 */
function normaliseUnit(materialUnit: string, nodeUnit: string | null): string {
  const known = new Set(UNITS.map((u) => u.value));
  const cleaned = materialUnit.trim().toLowerCase();
  if (known.has(cleaned)) return cleaned;
  return nodeUnit ?? "each";
}

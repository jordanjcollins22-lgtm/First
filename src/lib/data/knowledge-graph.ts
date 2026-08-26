import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { Graph, GraphEdge, GraphNode, NodeStatus, NodeType, RelationshipType } from "@/lib/knowledge-graph";
import type { Recurrence } from "@/lib/knowledge-schedule";
import { UNITS } from "@/lib/knowledge-cost";

export interface UnitOption {
  value: string;
  label: string;
  plural: string;
  /** Hours in one, where it is a stretch of somebody's day. */
  hours: number | null;
  custom: boolean;
}

export interface KnowledgeGraphData extends Graph {
  /** Every tag in use, for the filter list. */
  tags: string[];
  /** The built-in units and the ones this business typed itself, in one list
   * so a picker never has to know the difference. */
  units: UnitOption[];
  setupNeeded: boolean;
}

const EMPTY: KnowledgeGraphData = { nodes: [], edges: [], tags: [], units: [], setupNeeded: true };

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

  const [nodeRes, edgeRes, tagRes, unitRes] = await Promise.all([
    supabase
      .from("knowledge_nodes")
      .select(
        "id, title, description, node_type, status, importance, unit, cost_basis, output_per_unit, output_unit, run_size, run_unit, fixed_cost, duration_hours, hourly_rate, purchase_url, material_id, tool_id, potential_value, notes, position_x, position_y, scheduled_for, recurrence, recurrence_interval, last_done_at, times_done, created_by, created_at, updated_at"
      )
      .order("created_at"),
    supabase
      .from("knowledge_relationships")
      .select("id, source_node_id, target_node_id, relationship_type, strength, quantity, step_order, notes"),
    supabase.from("knowledge_node_tags").select("node_id, knowledge_tags(name)"),
    // Units this business typed itself. A table that is not there yet costs
    // the custom units, not the graph.
    supabase.from("knowledge_units").select("name, plural, hours"),
  ]);

  if (isMissingTable(nodeRes.error)) return EMPTY;
  if (nodeRes.error) throw nodeRes.error;

  const customUnits: CustomUnit[] = ((unitRes.data ?? []) as unknown as {
    name: string;
    plural: string | null;
    hours: number | null;
  }[]).map((u) => ({
    name: u.name,
    plural: u.plural,
    hours: u.hours != null ? Number(u.hours) : null,
  }));

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

  const toolIds = [
    ...new Set(
      ((nodeRes.data ?? []) as unknown as { tool_id: string | null }[])
        .map((n) => n.tool_id)
        .filter((id): id is string => id != null)
    ),
  ];

  const materials = new Map<string, MaterialLink>();
  if (materialIds.length > 0) {
    const { data: materialRows } = await supabase
      .from("materials")
      .select("id, name, cost_per_unit, unit, kind, purchase_url, quantity_on_hand, reorder_threshold, on_order")
      .in("id", materialIds);

    for (const row of (materialRows ?? []) as unknown as MaterialRow[]) {
      materials.set(row.id, {
        name: row.name,
        costPerUnit: row.cost_per_unit != null ? Number(row.cost_per_unit) : null,
        unit: row.unit,
        // An inventory row marked "other" is a fee, not stock. Its price is
        // the whole price, not the price of one of them.
        isFee: row.kind === "other",
        purchaseUrl: row.purchase_url,
        stockOnHand: row.quantity_on_hand != null ? Number(row.quantity_on_hand) : null,
        reorderThreshold: row.reorder_threshold != null ? Number(row.reorder_threshold) : null,
        onOrder: row.on_order ?? false,
      });
    }
  }

  if (toolIds.length > 0) {
    const { data: toolRows } = await supabase
      .from("tools")
      .select("id, name, cost, cost_to_own, purchase_url, quantity, reorder_threshold, on_order")
      .in("id", toolIds);

    for (const row of (toolRows ?? []) as unknown as ToolRow[]) {
      materials.set(row.id, {
        name: row.name,
        // What it costs to have one. A rental has no purchase price, so what
        // it costs to own stands in — otherwise the thing the whole idea
        // hangs on shows as free.
        costPerUnit:
          row.cost != null
            ? Number(row.cost)
            : row.cost_to_own != null
              ? Number(row.cost_to_own)
              : null,
        unit: "each",
        purchaseUrl: row.purchase_url,
        stockOnHand: row.quantity != null ? Number(row.quantity) : null,
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
      cost_basis: string | null;
      output_per_unit: number | null;
      output_unit: string | null;
      run_size: number | null;
      run_unit: string | null;
      fixed_cost: number | null;
      duration_hours: number | null;
      hourly_rate: number | null;
      purchase_url: string | null;
      material_id: string | null;
      tool_id: string | null;
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
    const material = materials.get(n.material_id ?? n.tool_id ?? "");
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
    // A fee has no per-unit price: the whole of it is the fixed cost below.
    estimatedCost: material?.isFee ? null : material?.costPerUnit ?? null,
    unit: material ? normaliseUnit(material.unit, n.unit) : n.unit ?? "each",
    costBasis:
      n.cost_basis === "consumable" || n.cost_basis === "capital" ? n.cost_basis : null,
    unitHours: hoursIn(material ? normaliseUnit(material.unit, n.unit) : n.unit ?? "each", customUnits),
    outputPerUnit: n.output_per_unit != null ? Number(n.output_per_unit) : null,
    outputUnit: n.output_unit,
    runSize: n.run_size != null ? Number(n.run_size) : null,
    runUnit: n.run_unit,
    durationHours: n.duration_hours != null ? Number(n.duration_hours) : null,
    hourlyRate: n.hourly_rate != null ? Number(n.hourly_rate) : null,
    fixedCost: material?.isFee
      ? material.costPerUnit
      : n.fixed_cost != null
        ? Number(n.fixed_cost)
        : null,
    purchaseUrl: material?.purchaseUrl ?? n.purchase_url,
    materialId: n.material_id,
    toolId: n.tool_id,
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
      step_order: number | null;
      notes: string | null;
    }[]
  ).map((e) => ({
    id: e.id,
    sourceId: e.source_node_id,
    targetId: e.target_node_id,
    relationshipType: e.relationship_type as RelationshipType,
    strength: e.strength,
    quantity: e.quantity != null ? Number(e.quantity) : null,
    stepOrder: e.step_order,
    notes: e.notes,
  }));

  return {
    nodes,
    edges,
    tags: [...allTags].sort(),
    units: mergeUnits(customUnits),
    setupNeeded: false,
  };
}

interface MaterialRow {
  id: string;
  name: string;
  cost_per_unit: number | null;
  unit: string;
  kind: string | null;
  purchase_url: string | null;
  quantity_on_hand: number | null;
  reorder_threshold: number | null;
  on_order: boolean | null;
}

interface MaterialLink {
  name: string;
  costPerUnit: number | null;
  unit: string;
  isFee?: boolean;
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

interface ToolRow {
  id: string;
  name: string;
  cost: number | null;
  cost_to_own: number | null;
  purchase_url: string | null;
  quantity: number | null;
  reorder_threshold: number | null;
  on_order: boolean | null;
}

interface CustomUnit {
  name: string;
  plural: string | null;
  hours: number | null;
}

/**
 * Hours in one of a unit, or nothing where it is a thing rather than a
 * stretch of somebody's day.
 *
 * Resolved here, once, so the cost functions can stay pure functions of a
 * node and never need to know which units this business invented.
 */
function hoursIn(unit: string, customUnits: CustomUnit[]): number | null {
  const custom = customUnits.find((u) => u.name === unit);
  if (custom) return custom.hours;
  const builtIn = UNITS.find((u) => u.value === unit);
  return builtIn?.time ? builtIn.hours ?? 1 : null;
}

/**
 * One list of units, built-in and home-made together.
 *
 * A unit somebody typed wins where the names collide: they meant their own
 * definition of a "load", not ours.
 */
function mergeUnits(customUnits: CustomUnit[]): UnitOption[] {
  const merged = new Map<string, UnitOption>();

  for (const unit of UNITS) {
    const noun = unit.label.replace(/^per /, "");
    merged.set(unit.value, {
      value: unit.value,
      label: unit.label,
      plural: unit.plural ?? (noun.endsWith("s") ? noun : `${noun}s`),
      hours: unit.hours ?? null,
      custom: false,
    });
  }

  for (const unit of customUnits) {
    merged.set(unit.name, {
      value: unit.name,
      label: `per ${unit.name}`,
      plural: unit.plural ?? `${unit.name}s`,
      hours: unit.hours,
      custom: true,
    });
  }

  return [...merged.values()].sort(
    (a, b) => Number(a.custom) - Number(b.custom) || a.value.localeCompare(b.value)
  );
}

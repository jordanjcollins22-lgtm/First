import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { Movement } from "@/lib/inventory-usage";

export interface InventoryCode {
  id: string;
  code: string;
  toolId: string | null;
  materialId: string | null;
  storageLocation: string | null;
  label: string | null;
  expectedQuantity: number | null;
}

export interface ScannedItem {
  code: InventoryCode;
  /** What the label is stuck to. Null for a place-code with nothing behind it. */
  name: string;
  unit: string;
  kind: "tool" | "material" | "place";
  onHand: number | null;
  reorderThreshold: number | null;
  movements: Movement[];
}

/**
 * What is behind a scanned code.
 *
 * One round trip for the code, one for the thing, one for its history —
 * because the page that opens after a scan has to be useful in the two
 * seconds somebody is standing there holding a saw.
 */
export async function getScannedItem(rawCode: string): Promise<ScannedItem | null> {
  const supabase = await createClient();

  const { data: codeRow, error } = await supabase
    .from("inventory_codes")
    .select("id, code, tool_id, material_id, storage_location, label, expected_quantity")
    .eq("code", rawCode)
    .eq("active", true)
    .maybeSingle();

  if (isMissingTable(error)) return null;
  if (error || !codeRow) return null;

  const code: InventoryCode = {
    id: codeRow.id as string,
    code: codeRow.code as string,
    toolId: (codeRow.tool_id as string | null) ?? null,
    materialId: (codeRow.material_id as string | null) ?? null,
    storageLocation: (codeRow.storage_location as string | null) ?? null,
    label: (codeRow.label as string | null) ?? null,
    expectedQuantity:
      codeRow.expected_quantity != null ? Number(codeRow.expected_quantity) : null,
  };

  const movements = await listMovements({ toolId: code.toolId, materialId: code.materialId });

  if (code.toolId) {
    const { data } = await supabase
      .from("tools")
      .select("name, quantity, reorder_threshold")
      .eq("id", code.toolId)
      .maybeSingle();

    return {
      code,
      name: (data?.name as string) ?? "Unknown tool",
      unit: "each",
      kind: "tool",
      onHand: data?.quantity != null ? Number(data.quantity) : null,
      reorderThreshold: data?.reorder_threshold != null ? Number(data.reorder_threshold) : null,
      movements,
    };
  }

  if (code.materialId) {
    const { data } = await supabase
      .from("materials")
      .select("name, unit, quantity_on_hand, reorder_threshold")
      .eq("id", code.materialId)
      .maybeSingle();

    return {
      code,
      name: (data?.name as string) ?? "Unknown material",
      unit: (data?.unit as string) ?? "each",
      kind: "material",
      onHand: data?.quantity_on_hand != null ? Number(data.quantity_on_hand) : null,
      reorderThreshold: data?.reorder_threshold != null ? Number(data.reorder_threshold) : null,
      movements,
    };
  }

  return {
    code,
    name: code.label ?? code.storageLocation ?? "Storage",
    unit: "each",
    kind: "place",
    onHand: code.expectedQuantity,
    reorderThreshold: null,
    movements,
  };
}

/** Every time this thing moved, oldest first. The whole point of the table. */
export async function listMovements(subject: {
  toolId?: string | null;
  materialId?: string | null;
}): Promise<Movement[]> {
  if (!subject.toolId && !subject.materialId) return [];

  const supabase = await createClient();
  let query = supabase
    .from("inventory_movements")
    .select("id, direction, quantity, job_id, note, happened_at, profile_id, profiles(full_name, email)")
    .order("happened_at");

  query = subject.toolId
    ? query.eq("tool_id", subject.toolId)
    : query.eq("material_id", subject.materialId!);

  const { data, error } = await query;
  if (error) return [];

  return ((data ?? []) as unknown as {
    id: string;
    direction: string;
    quantity: number;
    job_id: string | null;
    note: string | null;
    happened_at: string;
    profile_id: string | null;
    profiles: { full_name: string | null; email: string | null } | null;
  }[]).map((row) => ({
    id: row.id,
    direction: row.direction as Movement["direction"],
    quantity: Number(row.quantity),
    personId: row.profile_id,
    personName: row.profiles?.full_name || row.profiles?.email || null,
    jobId: row.job_id,
    note: row.note,
    happenedAt: row.happened_at,
  }));
}

export interface CodeRow extends InventoryCode {
  name: string;
}

/** Every code in the org, for the label sheet. */
export async function listInventoryCodes(): Promise<CodeRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("inventory_codes")
    .select(
      "id, code, tool_id, material_id, storage_location, label, expected_quantity, tools(name), materials(name)"
    )
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) return [];

  return ((data ?? []) as unknown as {
    id: string;
    code: string;
    tool_id: string | null;
    material_id: string | null;
    storage_location: string | null;
    label: string | null;
    expected_quantity: number | null;
    tools: { name: string } | null;
    materials: { name: string } | null;
  }[]).map((row) => ({
    id: row.id,
    code: row.code,
    toolId: row.tool_id,
    materialId: row.material_id,
    storageLocation: row.storage_location,
    label: row.label,
    expectedQuantity: row.expected_quantity != null ? Number(row.expected_quantity) : null,
    name: row.tools?.name ?? row.materials?.name ?? row.label ?? row.storage_location ?? "Storage",
  }));
}

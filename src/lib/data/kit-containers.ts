import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { ContainerKind, ContainerPart, KitContainer } from "@/lib/kit-containers";

/**
 * The containers a business's kits travel in, with their parts.
 *
 * Two queries rather than an embed: the parts of a container are a small list
 * and joining them through PostgREST buys nothing but a type nobody can read.
 */
export async function listKitContainers(): Promise<KitContainer[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const { data: containerRows } = await supabase
    .from("kit_containers")
    .select(
      "id, name, kits, kind, quantity, cost, purchase_url, broken, on_order, reorder_threshold, image_path, notes, archived_at"
    )
    .eq("organization_id", organizationId)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name");

  const containers = containerRows ?? [];
  if (containers.length === 0) return [];

  const { data: partRows } = await supabase
    .from("kit_container_parts")
    .select("id, container_id, name, quantity, cost, purchase_url, broken, on_order, notes, position")
    .in(
      "container_id",
      containers.map((container) => container.id)
    )
    .order("position")
    .order("name");

  const partsOf = new Map<string, ContainerPart[]>();
  for (const row of partRows ?? []) {
    const list = partsOf.get(row.container_id) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      quantity: row.quantity ?? 1,
      cost: row.cost,
      purchaseUrl: row.purchase_url,
      broken: row.broken ?? 0,
      onOrder: row.on_order ?? false,
      notes: row.notes,
      position: row.position ?? 0,
    });
    partsOf.set(row.container_id, list);
  }

  return containers.map((container) => ({
    id: container.id,
    name: container.name,
    kits: (container.kits ?? []) as number[],
    kind: (container.kind as ContainerKind) ?? "bought",
    quantity: container.quantity,
    cost: container.cost,
    purchaseUrl: container.purchase_url,
    broken: container.broken ?? 0,
    onOrder: container.on_order ?? false,
    reorderThreshold: container.reorder_threshold,
    imagePath: container.image_path,
    notes: container.notes,
    archivedAt: container.archived_at,
    parts: partsOf.get(container.id) ?? [],
  }));
}

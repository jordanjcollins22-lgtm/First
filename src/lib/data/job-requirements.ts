import { createClient } from "@/lib/supabase/server";
import type { ConfirmationState } from "@/lib/readiness";

/**
 * What a job actually needs, read off the services it sold.
 *
 * The point of this file is that nothing here is a guess and nothing is
 * inferred from silence. A job needs measuring because a service on it is
 * priced by the square foot. It needs mulch because the service that was sold
 * lists mulch. It needs a chainsaw because the service lists one. If the
 * services need none of those things, the check does not apply -- a bush trim
 * is not held up waiting for a square-foot measurement that would mean
 * nothing.
 */

export interface JobRequirements {
  /** Service type ids on the job, from the scope and what the client asked for. */
  serviceTypeIds: string[];
  /** Any of them priced by measurement. */
  measurementRequired: boolean;
  materials: ConfirmationState;
  materialsSource: string;
  equipment: ConfirmationState;
  equipmentSource: string;
}

/** A pricing basis that means somebody has to measure the ground. */
function pricedByMeasurement(basis: string | null, unit: string | null): boolean {
  const text = `${basis ?? ""} ${unit ?? ""}`.toLowerCase();
  return /sq|square|linear|foot|feet|ft|yard|area|per_unit_area/.test(text);
}

interface Zoneish {
  serviceTypeId?: string;
  service_type_id?: string;
  services?: { serviceTypeId?: string; service_type_id?: string }[];
}

/** Every service on this job: what was drawn, plus what the client asked for. */
function serviceIdsFrom(zones: unknown, requested: { service_type_id: string }[]): string[] {
  const ids = new Set<string>(requested.map((row) => row.service_type_id));
  for (const zone of (Array.isArray(zones) ? zones : []) as Zoneish[]) {
    const own = zone.serviceTypeId ?? zone.service_type_id;
    if (own) ids.add(own);
    for (const service of zone.services ?? []) {
      const id = service.serviceTypeId ?? service.service_type_id;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Whether the stock behind a requirement is actually there.
 *
 * On hand above its reorder threshold, or on order. Both are real evidence
 * from the inventory the business already keeps; neither is somebody's
 * assumption. Where a requirement exists and the stock is not there, the state
 * is `required_unconfirmed` -- which fails the gate, and is cleared either by
 * the stock arriving or by a manager confirming it by hand.
 */
function stockState(
  rows: { name: string; quantity: number | null; threshold: number | null; onOrder: boolean }[]
): { state: ConfirmationState; source: string } {
  if (rows.length === 0) {
    return { state: "not_required", source: "No service on this job lists any" };
  }
  const short = rows.filter((row) => {
    if (row.onOrder) return false;
    const have = row.quantity ?? 0;
    const floor = row.threshold ?? 0;
    return have <= floor;
  });
  if (short.length === 0) {
    return { state: "confirmed", source: `In stock or on order: ${rows.map((r) => r.name).join(", ")}` };
  }
  return {
    state: "required_unconfirmed",
    source: `Not in stock and not on order: ${short.map((r) => r.name).join(", ")}`,
  };
}

export async function jobRequirements(jobId: string): Promise<JobRequirements> {
  const supabase = await createClient();

  const [{ data: design }, { data: requested }] = await Promise.all([
    supabase.from("canvas_designs").select("zones").eq("job_id", jobId).maybeSingle(),
    supabase.from("job_requested_services").select("service_type_id").eq("job_id", jobId),
  ]);

  const serviceTypeIds = serviceIdsFrom(
    design?.zones,
    (requested ?? []) as unknown as { service_type_id: string }[]
  );

  if (serviceTypeIds.length === 0) {
    return {
      serviceTypeIds: [],
      // Nothing is known about what this job sells, so nothing can be
      // declared unnecessary: measuring is required until the scope says
      // otherwise. Unknown is not "not needed" any more than it is "fine".
      measurementRequired: true,
      materials: "required_unconfirmed",
      materialsSource: "No services on the job yet, so nothing can be confirmed",
      equipment: "required_unconfirmed",
      equipmentSource: "No services on the job yet, so nothing can be confirmed",
    };
  }

  const [{ data: services }, { data: serviceMaterials }, { data: serviceTools }] = await Promise.all([
    supabase.from("services").select("service_type_id, pricing_basis, cost_unit").in("service_type_id", serviceTypeIds),
    supabase.from("service_materials").select("material_id").in("service_type_id", serviceTypeIds),
    supabase.from("service_tools").select("tool_id").in("service_type_id", serviceTypeIds),
  ]);

  const measurementRequired = ((services ?? []) as { pricing_basis: string | null; cost_unit: string | null }[]).some(
    (row) => pricedByMeasurement(row.pricing_basis, row.cost_unit)
  );

  const materialIds = [...new Set(((serviceMaterials ?? []) as { material_id: string }[]).map((r) => r.material_id))];
  const toolIds = [...new Set(((serviceTools ?? []) as { tool_id: string }[]).map((r) => r.tool_id))];

  const [{ data: materials }, { data: tools }] = await Promise.all([
    materialIds.length > 0
      ? supabase.from("materials").select("name, quantity_on_hand, reorder_threshold, on_order").in("id", materialIds)
      : Promise.resolve({ data: [] }),
    toolIds.length > 0
      ? supabase.from("tools").select("name, quantity, reorder_threshold, on_order").in("id", toolIds)
      : Promise.resolve({ data: [] }),
  ]);

  const materialState = stockState(
    ((materials ?? []) as { name: string; quantity_on_hand: number | null; reorder_threshold: number | null; on_order: boolean | null }[]).map(
      (row) => ({
        name: row.name,
        quantity: row.quantity_on_hand,
        threshold: row.reorder_threshold,
        onOrder: Boolean(row.on_order),
      })
    )
  );
  const toolState = stockState(
    ((tools ?? []) as { name: string; quantity: number | null; reorder_threshold: number | null; on_order: boolean | null }[]).map(
      (row) => ({
        name: row.name,
        quantity: row.quantity,
        threshold: row.reorder_threshold,
        onOrder: Boolean(row.on_order),
      })
    )
  );

  return {
    serviceTypeIds,
    measurementRequired,
    materials: materialState.state,
    materialsSource: materialState.source,
    equipment: toolState.state,
    equipmentSource: toolState.source,
  };
}

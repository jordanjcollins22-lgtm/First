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
  servicesSource: string;
  /** Any of them priced by measurement. Meaningless until services are known. */
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
 * What the inventory can and cannot prove.
 *
 * It cannot prove enough. The reorder threshold answers "should we buy more
 * mulch", not "are there forty bags set aside for the Henderson job", and
 * treating the first as the second is how a crew arrives with three bags. The
 * app has no per-job quantities and no reservations, so it cannot do the
 * arithmetic, and it does not pretend to: a job with requirements is
 * `required_unconfirmed` until a person confirms it, whatever the shelf says.
 *
 * The stock is still read, because it is worth telling that person what they
 * are about to confirm -- "nothing on the shelf and nothing on order" is a
 * different conversation from "plenty in stock". When
 * `job_material_requirements.quantity_required` and reservations exist, this
 * is where the proof goes and the confirmation becomes the exception.
 *
 * The only thing it settles on its own is the negative: no service on this job
 * lists any, so there is nothing to confirm.
 */
function stockState(
  what: string,
  rows: { name: string; quantity: number | null; threshold: number | null; onOrder: boolean }[]
): { state: ConfirmationState; source: string } {
  if (rows.length === 0) {
    return { state: "not_required", source: `No service on this job lists any ${what}` };
  }
  const bare = rows.filter((row) => !row.onOrder && (row.quantity ?? 0) <= 0);
  const ordered = rows.filter((row) => row.onOrder);
  const held = rows.filter((row) => !row.onOrder && (row.quantity ?? 0) > 0);

  const notes: string[] = [];
  if (bare.length > 0) notes.push(`none in stock and none on order: ${bare.map((r) => r.name).join(", ")}`);
  if (ordered.length > 0) notes.push(`on order: ${ordered.map((r) => r.name).join(", ")}`);
  if (held.length > 0) notes.push(`some in stock: ${held.map((r) => r.name).join(", ")}`);

  return {
    state: "required_unconfirmed",
    // Said plainly, because the person confirming needs to know the app is
    // showing them evidence rather than an answer.
    source: `${rows.length} needed by the services sold — ${notes.join("; ")}. Stock cannot prove enough for this job, so somebody has to confirm it.`,
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
      servicesSource: "Nothing on the scope and nothing the client asked for",
      // Not "measurement required" -- that would be a guess dressed as a
      // requirement. The services check is what fails; everything downstream
      // waits for it rather than inventing an answer.
      measurementRequired: false,
      materials: "required_unconfirmed",
      materialsSource: "The work is not described yet, so nothing can be worked out",
      equipment: "required_unconfirmed",
      equipmentSource: "The work is not described yet, so nothing can be worked out",
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
    "materials",
    ((materials ?? []) as { name: string; quantity_on_hand: number | null; reorder_threshold: number | null; on_order: boolean | null }[]).map(
      (row) => ({
        name: row.name,
        quantity: row.quantity_on_hand,
        threshold: row.reorder_threshold,
        onOrder: Boolean(row.on_order),
      })
    )
  );
  // Equipment is not a consumable. What matters is whether the machine can go
  // to this job on the day, and the app has no assignment or reservation
  // record to read that from -- so, like materials, it needs a person.
  const toolState = stockState(
    "equipment",
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
    servicesSource: `${serviceTypeIds.length} ${serviceTypeIds.length === 1 ? "service" : "services"} on the job`,
    measurementRequired,
    materials: materialState.state,
    materialsSource: materialState.source,
    equipment: toolState.state,
    equipmentSource: toolState.source,
  };
}

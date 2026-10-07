import type { SupabaseClient } from "@supabase/supabase-js";

import type { WorkZone } from "@/components/canvas/types";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { travelForProperty } from "@/lib/data/job-travel";
import { getMaterialSuppliers } from "@/lib/data/material-suppliers";
import { driveThereAndBack, forwardAreas } from "@/lib/data/price-approvals";
import { getProductionPricing } from "@/lib/data/production-pricing";
import { priceFromSuppliers } from "@/lib/forward-materials";
import { priceForward, readLines, type PriceLine } from "@/lib/forward-pricing";
import { zipOf } from "@/lib/material-suppliers";
import { isSalting } from "@/lib/salting";
import type { Database } from "@/lib/supabase/database.types";
import type { ProposalZoneSnapshot } from "@/types/domain";

export type ForwardPrice =
  | { ok: true; totalCents: number; snapshot: ProposalZoneSnapshot[]; lines: PriceLine[][] }
  | { ok: false; error: string; salting?: boolean };

/**
 * A job's price worked out the forward way, as the price card works it out:
 * each area's services (the ones given, else the ones saved, else the ones
 * suggested from the walkthrough), bulk materials from the closest supplier,
 * and the drive and time off the work. Returned as the proposal's areas,
 * repriced, ready to save, so the proposal, the job page and the price card
 * all say the same price.
 *
 * Salting is priced by the salt rules and is left alone.
 */
export async function forwardPriceForJob(supabase: SupabaseClient<Database>, organizationId: string, jobId: string, given?: unknown): Promise<ForwardPrice> {
  const [{ data: proposal }, { data: design }, { data: job }, catalog, pricing, bulk] = await Promise.all([
    supabase.from("job_proposals").select("scope_snapshot").eq("job_id", jobId).maybeSingle(),
    supabase.from("canvas_designs").select("zones").eq("job_id", jobId).maybeSingle(),
    supabase.from("jobs").select("property:properties(lat, lng, address)").eq("id", jobId).maybeSingle(),
    getCanvasCatalog(),
    getProductionPricing(supabase, organizationId),
    getMaterialSuppliers(supabase, organizationId),
  ]);
  if (!proposal) return { ok: false, error: "There is no proposal on this job." };
  const snapshot = (proposal.scope_snapshot ?? []) as unknown as ProposalZoneSnapshot[];
  const zones = ((design?.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service);
  if (zones.some((z) => isSalting(z.service!.typeId))) return { ok: false, error: "Salting is priced by the salt rules.", salting: true };
  if (zones.length === 0 || zones.length !== snapshot.length) return { ok: false, error: "The areas have changed since this opened. Reload the page." };

  const setup = { equation: pricing.equation, services: pricing.services };
  let lines: PriceLine[][];
  if (given !== undefined) {
    const read = readLines(given, snapshot.length, setup.services);
    if (!read) return { ok: false, error: "The areas have changed since this opened. Reload the page." };
    lines = read;
  } else {
    lines = forwardAreas(zones, snapshot, (typeId) => catalog.servicePricing.find((p) => p.service_type_id === typeId)?.name ?? typeId, setup).map((a) => a.lines);
  }

  const at = (job?.property ?? null) as { lat: number | null; lng: number | null; address: string | null } | null;
  const site = at?.lat != null && at?.lng != null ? { lat: at.lat, lng: at.lng, zip: zipOf(at.address) } : null;
  lines = priceFromSuppliers(lines, setup.services, bulk.suppliers, site).lines;
  const travel = await travelForProperty(supabase, organizationId, site ? { lat: site.lat, lng: site.lng } : null).catch(() => null);
  const priced = priceForward(lines, setup.equation, setup.services, travel ? driveThereAndBack(travel) : null);
  if (priced.rCents <= 0) return { ok: false, error: "Every service is at nothing. Put in the quantities first." };
  return {
    ok: true,
    totalCents: priced.rCents,
    lines,
    snapshot: snapshot.map((zone, i) => ({ ...zone, priceCents: priced.areas[i].rCents, priceDerived: true, lines: lines[i] })),
  };
}

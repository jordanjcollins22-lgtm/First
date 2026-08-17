import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeAddress } from "@/lib/dedupe";
import { searchPropertiesNear } from "@/lib/rentcast";
import { isRentcastConfigured } from "@/lib/env";
import { calibrateFromHistory, estimateTicket, TARGET_TICKET } from "@/lib/leads";
import { planGrowth, type GrowthBudget, type SeedCandidate } from "@/lib/prospecting";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Grows the prospect list on its own.
 *
 * Finished jobs are the seeds: for each one, the properties around it become
 * candidates. Anything already a client or already on the list is dropped, and
 * lots below the size worth a $5k job are skipped, so the list stays callable
 * rather than merely large.
 *
 * Runs nightly from the cron and on demand from the Leads page. Never throws —
 * a bad night should cost a skipped run, not a failed cron.
 */

export interface GrowthReport {
  seedsWorked: string[];
  found: number;
  added: number;
  skippedExisting: number;
  skippedSmall: number;
  note: string | null;
}

type Client = SupabaseClient<Database>;

/** Below this, a landscaping job rarely reaches the target ticket. */
const MIN_ACREAGE = 0.25;

const EMPTY: GrowthReport = {
  seedsWorked: [],
  found: 0,
  added: 0,
  skippedExisting: 0,
  skippedSmall: 0,
  note: null,
};

export async function growProspects(
  supabase: Client,
  organizationId: string,
  budget: GrowthBudget
): Promise<GrowthReport> {
  if (!isRentcastConfigured) {
    return { ...EMPTY, note: "RentCast isn't configured — add RENTCAST_API_KEY and the list can grow itself." };
  }

  // Seeds: finished and won work first, business locations as a fallback.
  const [{ data: jobs }, { data: locations }, { data: proposals }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, updated_at, project_end_date, property_id, properties(address, lat, lng)")
      .in("status", ["completed", "approved", "in_progress"]),
    supabase.from("business_locations").select("id, name, lat, lng"),
    supabase.from("job_proposals").select("job_id, status, total_cost"),
  ]);

  const totalByJob = new Map(
    ((proposals ?? []) as { job_id: string; status: string; total_cost: number | null }[])
      .filter((p) => p.status === "accepted")
      .map((p) => [p.job_id, p.total_cost != null ? Number(p.total_cost) : null])
  );

  const jobSeeds: SeedCandidate[] = (
    (jobs ?? []) as unknown as {
      id: string;
      updated_at: string;
      project_end_date: string | null;
      properties: { address: string; lat: number; lng: number } | null;
    }[]
  )
    .filter((j) => j.properties)
    .map((j) => ({
      id: j.id,
      lat: j.properties!.lat,
      lng: j.properties!.lng,
      label: j.properties!.address,
      wonValue: totalByJob.get(j.id) ?? null,
      date: j.project_end_date ?? j.updated_at,
    }));

  const locationSeeds: SeedCandidate[] = ((locations ?? []) as { id: string; name: string; lat: number; lng: number }[]).map(
    (l) => ({ id: l.id, lat: l.lat, lng: l.lng, label: l.name, wonValue: null, date: null })
  );

  const plan = planGrowth(jobSeeds, locationSeeds, TARGET_TICKET, budget);
  if (plan.seeds.length === 0) {
    return { ...EMPTY, note: "Nothing to grow from yet — finish a job, or add a business location." };
  }

  // Everything already known, so the same house is never added twice.
  const [{ data: properties }, { data: existingProspects }] = await Promise.all([
    supabase.from("properties").select("address"),
    supabase.from("lead_prospects").select("address_key"),
  ]);

  const known = new Set<string>();
  for (const p of properties ?? []) known.add(normalizeAddress(p.address));
  for (const p of existingProspects ?? []) known.add(p.address_key);

  const calibration = calibrateFromHistory([]);
  const seedsWorked: string[] = [];
  let found = 0;
  let skippedExisting = 0;
  let skippedSmall = 0;
  const rows: Database["public"]["Tables"]["lead_prospects"]["Insert"][] = [];

  for (const seed of plan.seeds) {
    const nearby = await searchPropertiesNear(seed.lat, seed.lng, plan.radiusMiles, plan.perSeed);
    seedsWorked.push(seed.label);
    found += nearby.length;

    for (const property of nearby) {
      const addressKey = normalizeAddress(property.address);
      if (!addressKey) continue;

      if (known.has(addressKey)) {
        skippedExisting++;
        continue;
      }
      if (property.acreage != null && property.acreage < MIN_ACREAGE) {
        skippedSmall++;
        continue;
      }

      known.add(addressKey);
      const estimate = estimateTicket(property.acreage, calibration);

      rows.push({
        organization_id: organizationId,
        source: seed.kind === "location" ? "near_location" : "near_job",
        source_batch: `Near ${seed.label}`,
        owner_name: property.ownerName,
        address: property.address,
        address_key: addressKey,
        city: property.city,
        state: property.state,
        zip: property.zip,
        lat: property.lat,
        lng: property.lng,
        acreage: property.acreage,
        sqft: property.sqft,
        year_built: property.yearBuilt,
        estimated_ticket: estimate,
        score: estimate != null && estimate >= TARGET_TICKET ? 45 : 20,
      });
    }
  }

  if (rows.length === 0) {
    return {
      seedsWorked,
      found,
      added: 0,
      skippedExisting,
      skippedSmall,
      note: found === 0 ? "The property service returned nothing for those areas." : null,
    };
  }

  const { data: inserted, error } = await supabase
    .from("lead_prospects")
    .upsert(rows, { onConflict: "organization_id,address_key", ignoreDuplicates: true })
    .select("id");

  if (error) {
    return { seedsWorked, found, added: 0, skippedExisting, skippedSmall, note: error.message };
  }

  return {
    seedsWorked,
    found,
    added: inserted?.length ?? 0,
    skippedExisting,
    skippedSmall,
    note: null,
  };
}

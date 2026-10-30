import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getPerDiem } from "@/lib/data/per-diem";
import { getProductionPricing } from "@/lib/data/production-pricing";
import { TYPICAL_MATERIAL_CENTS, TYPICAL_MINUTES } from "@/lib/instant-price";
import {
  estimateAccuracy,
  materialHealth,
  overheadParity,
  rateCardHealth,
  type AccuracySummary,
  type EstimatePair,
  type MaterialRow,
  type OverheadParity,
  type RateCardRow,
} from "@/lib/pricing-health";

/**
 * Everything the Pricing health page shows, read in one go.
 *
 * The rate card is read the way the canvas reads it, signed in, and then cut
 * down to what the client's estimate actually sees: active job materials
 * only. The comparison is every job that has both an instant estimate and a
 * proposal the client was sent, newest first and capped, because an old
 * estimate made before the rate card was filled in says little about today's.
 *
 * Each part loads on its own: a missing table costs its section, not the page.
 */

/** How many recent estimates the comparison reads. */
const RECENT_ESTIMATES = 300;

export interface PricingHealth {
  rateCard: RateCardRow[];
  materials: MaterialRow[];
  accuracy: AccuracySummary;
  /** Estimates still waiting on a sent proposal: they will count once it goes. */
  awaitingProposal: number;
  overhead: OverheadParity | null;
  /** Whether Production rates are the business's own or the starting figures. */
  productionSaved: boolean;
  problems: string[];
}

export async function getPricingHealth(): Promise<PricingHealth> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const problems: string[] = [];

  const [catalog, perDiem, production] = await Promise.all([
    getCanvasCatalog().catch((error: unknown) => {
      problems.push(`The rate card couldn't be read: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }),
    getPerDiem().catch(() => null),
    getProductionPricing(supabase, organizationId).catch(() => null),
  ]);

  const crewPeople = production ? production.equation.leads + production.equation.technicians : 2;
  const rateCard = catalog
    ? rateCardHealth(catalog.servicePricing, TYPICAL_MINUTES, production ? { services: production.services, crewPeople } : null)
    : [];
  const materials = catalog
    ? materialHealth(
        catalog.serviceMaterialRules,
        catalog.materials.filter((m) => m.active && m.category === "job"),
        TYPICAL_MATERIAL_CENTS
      )
    : [];

  const { pairs, awaiting } = await estimatePairs(organizationId).catch((error: unknown) => {
    problems.push(`Estimates couldn't be compared: ${error instanceof Error ? error.message : String(error)}`);
    return { pairs: [] as EstimatePair[], awaiting: 0 };
  });

  const overhead =
    perDiem && catalog
      ? overheadParity({
          basis: perDiem.basis,
          overheadPercent: perDiem.overheadPercent,
          perCrewHourCents: perDiem.perDiem.perCrewHour > 0 ? Math.round(perDiem.perDiem.perCrewHour * 100) : null,
          multiplier: perDiem.multiplier,
          crewCostPerHourCents: catalog.crewCostPerHourCents,
        })
      : null;

  return {
    rateCard,
    materials,
    accuracy: estimateAccuracy(pairs),
    awaitingProposal: awaiting,
    overhead,
    productionSaved: production?.saved ?? false,
    problems,
  };
}

/**
 * Jobs with an instant estimate and a proposal the client was sent. The
 * proposal's price before any discount: the estimate never knew about a
 * discount, and a pre-book special is not a measuring error.
 */
async function estimatePairs(organizationId: string): Promise<{ pairs: EstimatePair[]; awaiting: number }> {
  const supabase = await createClient();
  const estimates = await supabase
    .from("job_estimates")
    .select("job_id, total_cents, price, spots, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(RECENT_ESTIMATES);
  if (estimates.error) throw estimates.error;
  const rows = estimates.data ?? [];
  if (rows.length === 0) return { pairs: [], awaiting: 0 };

  const jobIds = rows.map((r) => r.job_id);
  const [proposals, jobs] = await Promise.all([
    supabase.from("job_proposals").select("job_id, status, total_cost").in("job_id", jobIds).in("status", ["sent", "accepted"]),
    supabase.from("jobs").select("id, name, job_number").in("id", jobIds),
  ]);
  if (proposals.error) throw proposals.error;

  const proposalByJob = new Map((proposals.data ?? []).map((p) => [p.job_id, p]));
  const jobById = new Map(((jobs.data ?? []) as { id: string; name: string; job_number: number | null }[]).map((j) => [j.id, j]));

  const pairs: EstimatePair[] = [];
  let awaiting = 0;
  for (const row of rows) {
    const proposal = proposalByJob.get(row.job_id);
    if (!proposal) {
      awaiting += 1;
      continue;
    }
    const job = jobById.get(row.job_id);
    const price = row.price as { subtotalCents?: unknown } | null;
    pairs.push({
      jobId: row.job_id,
      label: job ? `${job.job_number != null ? `#${job.job_number} ` : ""}${job.name}` : "A job",
      estimateCents: row.total_cents,
      estimateSubtotalCents: typeof price?.subtotalCents === "number" ? price.subtotalCents : null,
      proposalCents: Math.round(Number(proposal.total_cost ?? 0) * 100),
      choices: spotChoices(row.spots),
      status: proposal.status,
    });
  }
  return { pairs, awaiting };
}

/** Every tap choice on the job's spots, read defensively: spots is client-written jsonb. */
function spotChoices(spots: unknown): string[] {
  if (!Array.isArray(spots)) return [];
  const out = new Set<string>();
  for (const spot of spots) {
    const choices = (spot as { choices?: unknown } | null)?.choices;
    if (!Array.isArray(choices)) continue;
    for (const c of choices) if (typeof c === "string") out.add(c);
  }
  return [...out];
}

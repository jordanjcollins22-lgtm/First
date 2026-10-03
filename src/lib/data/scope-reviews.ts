import { createClient } from "@/lib/supabase/server";
import { reviewsFor, type ScopeRecommendation, type ZoneWithNote } from "@/lib/scope-review";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { serviceLabelFor } from "@/lib/zone-scope";
import type { WorkZone } from "@/components/canvas/types";

export function recommendationFromRow(r: {
  id: string;
  job_id: string;
  zone_index: number;
  zone_name: string;
  round: number;
  evaluator_note: string;
  service_label: string | null;
  recommended_text: string;
  status: string;
  decline_reason: string | null;
  decided_at: string | null;
  created_at: string;
}): ScopeRecommendation {
  return {
    id: r.id,
    jobId: r.job_id,
    zoneIndex: r.zone_index,
    zoneName: r.zone_name,
    round: r.round,
    evaluatorNote: r.evaluator_note,
    serviceLabel: r.service_label,
    recommendedText: r.recommended_text,
    status: r.status as ScopeRecommendation["status"],
    declineReason: r.decline_reason,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

/** Every round ever written for a job, oldest first. */
export async function listScopeRecommendations(jobId: string): Promise<ScopeRecommendation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scope_recommendations")
    .select("id, job_id, zone_index, zone_name, round, evaluator_note, service_label, recommended_text, status, decline_reason, decided_at, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(recommendationFromRow);
}

/**
 * The zones of a site map as the review sees them: each zone with a service,
 * its note, and the service's name. The price approval and the approval
 * itself both read it from here, so they can never disagree about which
 * areas still need their wording approved.
 */
export function zonesForReview(
  zones: WorkZone[],
  pricing: { service_type_id: string; name: string | null; scope_template?: string | null }[]
): ZoneWithNote[] {
  const pricingBy = new Map(pricing.map((p) => [p.service_type_id, p]));
  return zones
    .filter((z) => z.service)
    .map((z, zoneIndex) => {
      const def = z.service ? serviceTypeById(z.service.typeId) : undefined;
      const row = z.service ? pricingBy.get(z.service.typeId) : undefined;
      return {
        zoneIndex,
        zoneName: z.name,
        note: (z.service?.notes ?? "").trim(),
        serviceLabel: serviceLabelFor(def, row ? { name: row.name ?? "", scopeTemplate: row.scope_template ?? null } : undefined),
      };
    });
}

/**
 * For each job, the areas whose recommended wording nobody has approved or
 * declined yet: the price cannot be accepted until there are none.
 */
export async function wordingToApprove(
  designs: { jobId: string; zones: WorkZone[] }[],
  pricing: { service_type_id: string; name: string | null; scope_template?: string | null }[]
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (designs.length === 0) return out;
  const supabase = await createClient();
  const { data } = await supabase
    .from("scope_recommendations")
    .select("id, job_id, zone_index, zone_name, round, evaluator_note, service_label, recommended_text, status, decline_reason, decided_at, created_at")
    .in("job_id", designs.map((d) => d.jobId));
  const recs = (data ?? []).map(recommendationFromRow);
  for (const d of designs) {
    const open = reviewsFor(zonesForReview(d.zones, pricing), recs.filter((r) => r.jobId === d.jobId)).filter((r) => !r.settled);
    if (open.length > 0) out.set(d.jobId, open.map((r) => r.zoneName));
  }
  return out;
}

import { createClient } from "@/lib/supabase/server";
import type { ScopeRecommendation } from "@/lib/scope-review";

export function recommendationFromRow(r: {
  id: string;
  job_id: string;
  zone_index: number;
  zone_name: string;
  round: number;
  evaluator_note: string;
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
    .select("id, job_id, zone_index, zone_name, round, evaluator_note, recommended_text, status, decline_reason, decided_at, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(recommendationFromRow);
}

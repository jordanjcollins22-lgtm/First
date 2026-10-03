import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadMoney } from "@/lib/data/commission";
import { rankEvaluators, type EvaluatorInput, type EvaluatorStanding } from "@/lib/evaluation-leaderboard";
import { isFieldOnly } from "@/lib/affiliate-roles";

/**
 * Every evaluation with somebody on it, and what came of each.
 *
 * The person is the job's assignee: whoever the visit was put on. A job's
 * proposal is its latest one, because a rewritten proposal is the same sale
 * told again, not a second sale.
 */
export interface EvaluationBoards {
  /** Visits in the last ninety days. */
  recent: EvaluatorStanding[];
  allTime: EvaluatorStanding[];
}

export async function getEvaluationBoards(): Promise<EvaluationBoards> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return { recent: [], allTime: [] };

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select("id, assigned_to, evaluation_status, evaluation_date, status, property:properties(address, customer:customers(name))")
    .not("assigned_to", "is", null)
    .not("evaluation_date", "is", null)
    .limit(5000);
  if (error) throw error;
  const rows = (jobs ?? []) as unknown as {
    id: string;
    assigned_to: string;
    evaluation_status: string | null;
    evaluation_date: string | null;
    status: string;
    property: { address: string | null; customer: { name: string } | null } | null;
  }[];
  if (rows.length === 0) return { recent: [], allTime: [] };

  const jobIds = rows.map((j) => j.id);
  const [{ data: proposals }, { data: profiles }, money, { data: roleRows }] = await Promise.all([
    supabase
      .from("job_proposals")
      .select("job_id, status, total_cost, discount_amount, generated_at, responded_at, created_at")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, full_name, email").eq("organization_id", org),
    loadMoney(jobIds),
    supabase.from("profile_roles").select("profile_id, role_name"),
  ]);

  // A crew member put on a job as its assignee did not do the evaluation;
  // the visit was somebody else's and the proposal was somebody else's
  // writing. Only office people are judged here.
  const rolesOf = new Map<string, string[]>();
  for (const r of (roleRows ?? []) as { profile_id: string; role_name: string }[]) {
    rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role_name]);
  }
  const evaluates = (profileId: string) => !isFieldOnly(rolesOf.get(profileId) ?? []);

  // Latest proposal per job.
  const latest = new Map<string, { status: string; total_cost: number | null; discount_amount: number | null; generated_at: string | null; responded_at: string | null; created_at: string }>();
  for (const p of (proposals ?? []) as { job_id: string; status: string; total_cost: number | null; discount_amount: number | null; generated_at: string | null; responded_at: string | null; created_at: string }[]) {
    if (!latest.has(p.job_id)) latest.set(p.job_id, p);
  }
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, (p.full_name ?? "").trim() || (p.email ?? "").split("@")[0] || "Somebody"]));

  const byPerson = new Map<string, EvaluatorInput>();
  for (const j of rows) {
    if (!evaluates(j.assigned_to)) continue;
    const person = byPerson.get(j.assigned_to) ?? { profileId: j.assigned_to, name: nameOf.get(j.assigned_to) ?? "Somebody", jobs: [] };
    const p = latest.get(j.id) ?? null;
    const sent = p && p.status !== "draft" ? p.generated_at ?? p.created_at : null;
    person.jobs.push({
      jobId: j.id,
      clientName: j.property?.customer?.name ?? "Client",
      address: j.property?.address ?? null,
      evaluationStatus: j.evaluation_status,
      evaluationDate: j.evaluation_date,
      proposalSentAt: sent,
      proposalStatus: p?.status ?? null,
      proposalTotal: p ? Math.max(0, Number(p.total_cost ?? 0) - Number(p.discount_amount ?? 0)) : null,
      acceptedAt: p && p.status === "accepted" ? p.responded_at : null,
      collected: money.collected.get(j.id) ?? 0,
    });
    byPerson.set(j.assigned_to, person);
  }

  const inputs = [...byPerson.values()];
  const now = new Date();
  return {
    recent: rankEvaluators(inputs, { since: new Date(now.getTime() - 90 * 86_400_000), now }),
    allTime: rankEvaluators(inputs, { now }),
  };
}

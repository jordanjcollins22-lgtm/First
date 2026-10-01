import { createClient } from "@/lib/supabase/server";
import { dateKeyIn, zonedToUtc } from "@/lib/time-zone";
import { readPlan, stillToReview, walkPlan } from "@/lib/evaluation-visit";
import { evaluationStage, type EvaluationStage } from "@/lib/evaluations-today";

/**
 * Evaluations today, for the account manager: every visit booked today on a
 * client they manage (every visit, for the owner), where it has got to,
 * whether the client sent their pre-eval, and whether it is now theirs to
 * price or send. Read from what is already recorded; nobody taps anything
 * new for it.
 */

export interface EvaluationToday {
  jobId: string;
  client: string;
  address: string;
  evaluator: string | null;
  dueAt: string;
  preEval: boolean;
  /** When the account manager last emailed them the pre-eval form, if they have. */
  preEvalAskedAt: string | null;
  stage: EvaluationStage;
  areasReviewed: number;
  areasTotal: number;
  /** Where pricing and sending happen for this job. */
  reviewHref: string;
}

type Row = {
  id: string;
  status: string;
  evaluation_date: string;
  evaluation_status: string;
  evaluator_on_way_at: string | null;
  evaluator_arrived_at: string | null;
  evaluation_submitted_at: string | null;
  evaluation_plan: unknown;
  assignee: { full_name: string | null; email: string } | null;
  properties: { address: string | null; customers: { name: string | null; account_manager_id: string | null } | null } | null;
};

export async function getEvaluationsToday(viewer: { id: string; seesAll: boolean }): Promise<EvaluationToday[]> {
  const supabase = await createClient();
  const day = dateKeyIn(new Date());
  const from = zonedToUtc(day, "00:00").toISOString();
  const to = zonedToUtc(day, "23:59").toISOString();

  const { data } = await supabase
    .from("jobs")
    .select(
      "id, status, evaluation_date, evaluation_status, evaluator_on_way_at, evaluator_arrived_at, evaluation_submitted_at, evaluation_plan, assignee:profiles!jobs_assigned_to_fkey(full_name, email), properties(address, customers(name, account_manager_id))"
    )
    .gte("evaluation_date", from)
    .lte("evaluation_date", to)
    .order("evaluation_date");
  const rows = ((data ?? []) as unknown as Row[]).filter(
    (r) =>
      r.status !== "cancelled" &&
      r.evaluation_status !== "cancelled" &&
      (viewer.seesAll || r.properties?.customers?.account_manager_id === viewer.id)
  );
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const [{ data: intakes }, { data: proposals }, { data: asks }] = await Promise.all([
    supabase.from("evaluation_intakes").select("job_id, submitted_at").in("job_id", ids).not("submitted_at", "is", null),
    supabase.from("job_proposals").select("job_id, status, approved_at, generated_at, sent_at").in("job_id", ids),
    supabase.from("client_message_log").select("reference_id, created_at").eq("kind", "pre_eval_ask").eq("status", "sent").in("reference_id", ids).order("created_at"),
  ]);
  const askedAt = new Map(((asks ?? []) as { reference_id: string; created_at: string }[]).map((a) => [a.reference_id, a.created_at]));
  const sentForm = new Set(((intakes ?? []) as { job_id: string }[]).map((i) => i.job_id));
  const proposalFor = new Map(
    ((proposals ?? []) as { job_id: string; status: string; approved_at: string | null; generated_at: string | null; sent_at: string | null }[]).map((p) => [p.job_id, p])
  );

  const now = new Date();
  return rows.map((r) => {
    const plan = walkPlan(readPlan(r.evaluation_plan));
    const areasTotal = plan.filter((i) => i.keep !== false).length;
    const areasReviewed = areasTotal - stillToReview(plan).length;
    const proposal = proposalFor.get(r.id);
    const priced = proposal && proposal.status !== "needs_approval" ? (proposal.approved_at ?? proposal.generated_at ?? r.evaluation_submitted_at) : null;
    const preEval = sentForm.has(r.id);
    return {
      jobId: r.id,
      client: r.properties?.customers?.name || "Client",
      address: r.properties?.address ?? "",
      evaluator: r.assignee ? (r.assignee.full_name || r.assignee.email).split(/\s+/)[0] : null,
      dueAt: r.evaluation_date,
      preEval,
      preEvalAskedAt: askedAt.get(r.id) ?? null,
      areasReviewed,
      areasTotal,
      reviewHref: `/jobs/${r.id}?open=proposal`,
      stage: evaluationStage(
        {
          dueAt: r.evaluation_date,
          preEval,
          onWayAt: r.evaluator_on_way_at,
          arrivedAt: r.evaluator_arrived_at,
          submittedAt: r.evaluation_submitted_at ?? (r.evaluation_status === "completed" ? r.evaluator_arrived_at : null),
          pricedAt: priced ?? null,
          sentAt: proposal?.sent_at ?? null,
          areasReviewed,
          areasTotal,
        },
        now
      ),
    };
  });
}

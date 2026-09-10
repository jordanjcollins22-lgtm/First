import { createClient } from "@/lib/supabase/server";
import {
  byOwner,
  inState,
  stateCounts,
  type BoardEvaluation,
  type EvaluationState,
  type OwnerPile,
} from "@/lib/evaluation-board";

/**
 * Every evaluation this business has, before and after.
 *
 * Deliberately not filtered by job status. The selling screen only ever read
 * jobs still marked "estimating", which meant an evaluation disappeared the
 * moment it produced a proposal — fine for a to-do list, useless for "show me
 * everything we have booked and everything we have already done".
 *
 * Scoped by row-level security through the property, the way every other read
 * of jobs is: the jobs table carries no organisation of its own.
 */

interface Row {
  id: string;
  job_number: number | null;
  status: string;
  evaluation_status: string;
  evaluation_date: string | null;
  assigned_to: string | null;
  properties: { address: string | null; customers: { name: string | null } | null } | null;
  profiles: { full_name: string | null; email: string | null } | null;
}

export interface EvaluationBoard {
  all: BoardEvaluation[];
  needsSubmitting: BoardEvaluation[];
  upcoming: BoardEvaluation[];
  submitted: BoardEvaluation[];
  counts: Record<EvaluationState, number>;
  owners: OwnerPile[];
  now: string;
}

/** Enough history to see the year without dragging every job ever booked. */
const LIMIT = 500;

export async function getEvaluationBoard(): Promise<EvaluationBoard> {
  const supabase = await createClient();
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, job_number, status, evaluation_status, evaluation_date, assigned_to, " +
        "properties!inner(address, customers(name)), profiles!jobs_assigned_to_fkey(full_name, email)"
    )
    .order("evaluation_date", { ascending: false, nullsFirst: false })
    .limit(LIMIT);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Row[];

  // Which of them actually produced a proposal. Asked as one query rather than
  // one per row: this is the field the whole screen turns on, and an N+1 here
  // would be five hundred round trips on a page somebody opens every morning.
  const withProposals = new Set<string>();
  if (rows.length > 0) {
    const { data: proposals } = await supabase
      .from("job_proposals")
      .select("job_id")
      .in(
        "job_id",
        rows.map((row) => row.id)
      );
    for (const proposal of proposals ?? []) {
      if (proposal.job_id) withProposals.add(proposal.job_id);
    }
  }

  const all: BoardEvaluation[] = rows.map((row) => ({
    jobId: row.id,
    jobNumber: row.job_number,
    customerName: row.properties?.customers?.name ?? null,
    address: row.properties?.address ?? null,
    at: row.evaluation_date,
    evaluationStatus: row.evaluation_status,
    jobStatus: row.status,
    assignedToId: row.assigned_to,
    assignedToName: row.profiles?.full_name || row.profiles?.email || null,
    hasProposal: withProposals.has(row.id),
  }));

  return {
    all,
    needsSubmitting: inState(all, "needs-submitting", now),
    upcoming: inState(all, "upcoming", now),
    submitted: inState(all, "submitted", now),
    counts: stateCounts(all, now),
    owners: byOwner(all, now),
    now,
  };
}

import { createClient } from "@/lib/supabase/server";
import { canDoEvaluations } from "@/lib/affiliate-roles";
import {
  byOwner,
  inState,
  misassigned,
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
  profiles: { full_name: string | null; email: string | null; does_evaluations: boolean | null } | null;
}

export interface EvaluationBoard {
  all: BoardEvaluation[];
  needsSubmitting: BoardEvaluation[];
  upcoming: BoardEvaluation[];
  submitted: BoardEvaluation[];
  counts: Record<EvaluationState, number>;
  owners: OwnerPile[];
  /** Live evaluations parked on somebody who does not visit properties. */
  misassigned: BoardEvaluation[];
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
        "properties!inner(address, customers(name)), " +
        "profiles!jobs_assigned_to_fkey(full_name, email, does_evaluations)"
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

  // Whether each assignee can be sent to a property. Read once from the roles
  // rather than per row, because an evaluation sitting on a crew member is a
  // different problem from a late one and has to be named as one.
  const assignees = Array.from(
    new Set(rows.map((row) => row.assigned_to).filter((id): id is string => Boolean(id)))
  );
  const canEvaluate = new Map<string, boolean>();
  if (assignees.length > 0) {
    const [{ data: profiles }, { data: roleRows }] = await Promise.all([
      supabase.from("profiles").select("id, does_evaluations").in("id", assignees),
      supabase.from("profile_roles").select("profile_id, role_name").in("profile_id", assignees),
    ]);
    const rolesOf = new Map<string, string[]>();
    for (const role of roleRows ?? []) {
      const list = rolesOf.get(role.profile_id) ?? [];
      list.push(role.role_name);
      rolesOf.set(role.profile_id, list);
    }
    for (const profile of profiles ?? []) {
      canEvaluate.set(
        profile.id,
        canDoEvaluations(rolesOf.get(profile.id) ?? [], profile.does_evaluations)
      );
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
    assigneeDoesEvaluations: row.assigned_to == null ? null : canEvaluate.get(row.assigned_to) ?? null,
  }));

  return {
    all,
    needsSubmitting: inState(all, "needs-submitting", now),
    upcoming: inState(all, "upcoming", now),
    submitted: inState(all, "submitted", now),
    counts: stateCounts(all, now),
    owners: byOwner(all, now),
    misassigned: misassigned(all, now),
    now,
  };
}

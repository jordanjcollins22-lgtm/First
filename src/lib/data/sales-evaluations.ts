import { createClient } from "@/lib/supabase/server";
import type { SalesEvaluation } from "@/lib/sales-evaluations";

interface Row {
  id: string;
  job_number: number | null;
  status: string;
  evaluation_status: string;
  evaluation_date: string | null;
  assigned_to: string | null;
  properties: { address: string | null; customers: { name: string | null; account_manager_id: string | null } | null } | null;
  profiles: { full_name: string | null; email: string | null } | null;
}

/**
 * Every evaluation that has not yet produced a proposal.
 *
 * Scoped by row-level security through the property, the way every other read
 * of jobs is: the jobs table carries no organisation of its own.
 */
export async function listSalesEvaluations(): Promise<SalesEvaluation[]> {
  const supabase = await createClient();
  const [{ data, error }, { data: quoted }] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, job_number, status, evaluation_status, evaluation_date, " +
          "assigned_to, properties!inner(address, customers(name, account_manager_id)), profiles!jobs_assigned_to_fkey(full_name, email)"
      )
      .eq("status", "estimating")
      .limit(500),
    // A job with a proposal on it, in any state, has produced one. It used
    // to stay here on its job status alone, so a client whose quote went
    // out a week ago was still listed as an evaluation to write up.
    supabase.from("job_proposals").select("job_id").limit(2000),
  ]);
  if (error) throw error;
  const hasProposal = new Set((quoted ?? []).map((row) => row.job_id));

  return ((data ?? []) as unknown as Row[]).filter((row) => !hasProposal.has(row.id)).map((row) => ({
    jobId: row.id,
    jobNumber: row.job_number,
    customerName: row.properties?.customers?.name ?? null,
    address: row.properties?.address ?? null,
    at: row.evaluation_date,
    evaluationStatus: row.evaluation_status,
    status: row.status,
    assignedToName: row.profiles?.full_name || row.profiles?.email || null,
    assignedToId: row.assigned_to,
    accountManagerId: row.properties?.customers?.account_manager_id ?? null,
  }));
}

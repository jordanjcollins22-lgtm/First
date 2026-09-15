import { createClient } from "@/lib/supabase/server";
import type { SalesEvaluation } from "@/lib/sales-evaluations";

interface Row {
  id: string;
  job_number: number | null;
  status: string;
  evaluation_status: string;
  evaluation_date: string | null;
  properties: { address: string | null; customers: { name: string | null } | null } | null;
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
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, job_number, status, evaluation_status, evaluation_date, " +
        "properties!inner(address, customers(name)), profiles!jobs_assigned_to_fkey(full_name, email)"
    )
    .eq("status", "estimating")
    .limit(500);
  if (error) throw error;

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    jobId: row.id,
    jobNumber: row.job_number,
    customerName: row.properties?.customers?.name ?? null,
    address: row.properties?.address ?? null,
    at: row.evaluation_date,
    evaluationStatus: row.evaluation_status,
    status: row.status,
    assignedToName: row.profiles?.full_name || row.profiles?.email || null,
  }));
}

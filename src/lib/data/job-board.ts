import { createClient } from "@/lib/supabase/server";
import type { BoardJob } from "@/lib/job-board";

interface Row {
  id: string;
  job_number: number | null;
  name: string;
  status: string;
  project_start_date: string | null;
  evaluation_date: string | null;
  completed_at: string | null;
  properties: { address: string | null; customers: { name: string | null } | null } | null;
  profiles: { full_name: string | null; email: string | null } | null;
}

/**
 * Every job of this business, for the board.
 *
 * One read for all three views rather than one per tab: the tabs are rendered
 * together and hidden, so three reads would be three round trips to show one
 * screen.
 */
export async function listBoardJobs(): Promise<BoardJob[]> {
  // Scoped by row-level security through the property, the way every other
  // read of jobs is: the jobs table carries no organisation of its own.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select(
      "id, job_number, name, status, project_start_date, evaluation_date, completed_at, " +
        "properties!inner(address, customers(name)), profiles!jobs_assigned_to_fkey(full_name, email)"
    )
    .in("status", ["approved", "in_progress", "completed"])
    .limit(500);
  if (error) throw error;

  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    jobNumber: row.job_number,
    name: row.name,
    status: row.status,
    address: row.properties?.address ?? null,
    customerName: row.properties?.customers?.name ?? null,
    assignedToName: row.profiles?.full_name || row.profiles?.email || null,
    startsOn: row.project_start_date ?? row.evaluation_date ?? null,
    completedAt: row.completed_at,
  }));
}

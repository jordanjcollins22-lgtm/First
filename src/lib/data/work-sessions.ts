import { createClient } from "@/lib/supabase/server";
import type { JobTicket, JobWalkthrough, JobWorkSession } from "@/types/domain";

export interface JobScheduleData {
  sessions: JobWorkSession[];
  tickets: JobTicket[];
  /** Newest first — the order the walkthrough rules assume. */
  walkthroughs: JobWalkthrough[];
}

/**
 * A job's visits and its open snags, in one pass.
 *
 * Returns empty rather than throwing when migration 0080 hasn't run — the rest
 * of the job page shouldn't 500 over a panel that isn't set up yet.
 */
export async function getJobSchedule(jobId: string): Promise<JobScheduleData> {
  try {
    const supabase = await createClient();
    const [sessions, tickets, walkthroughs] = await Promise.all([
      supabase
        .from("job_work_sessions")
        .select("*")
        .eq("job_id", jobId)
        .order("starts_on", { ascending: true }),
      supabase
        .from("job_tickets")
        .select("*")
        .eq("job_id", jobId)
        .order("created_at", { ascending: false }),
      supabase
        .from("job_walkthroughs")
        .select("*")
        .eq("job_id", jobId)
        .order("requested_at", { ascending: false }),
    ]);

    return {
      sessions: (sessions.data ?? []) as unknown as JobWorkSession[],
      tickets: (tickets.data ?? []) as unknown as JobTicket[],
      walkthroughs: (walkthroughs.data ?? []) as unknown as JobWalkthrough[],
    };
  } catch {
    return { sessions: [], tickets: [], walkthroughs: [] };
  }
}

/**
 * Every live visit across the business, keyed by job, for the calendar.
 *
 * One query rather than one per job. Cancelled visits are left out here so
 * callers never have to remember to filter them.
 */
export async function listWorkSessionsByJob(): Promise<
  Map<string, { starts_on: string; ends_on: string; status: string }[]>
> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("job_work_sessions")
      .select("job_id, starts_on, ends_on, status")
      .neq("status", "cancelled")
      .order("starts_on", { ascending: true });

    const map = new Map<string, { starts_on: string; ends_on: string; status: string }[]>();
    for (const row of (data ?? []) as unknown as {
      job_id: string;
      starts_on: string;
      ends_on: string;
      status: string;
    }[]) {
      const list = map.get(row.job_id) ?? [];
      list.push({ starts_on: row.starts_on, ends_on: row.ends_on, status: row.status });
      map.set(row.job_id, list);
    }
    return map;
  } catch {
    // Before migration 0080 the calendar simply falls back to job windows.
    return new Map();
  }
}

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { busyBlocks, type BusyBlock, type EvaluationBooking, type TimeOffBooking, type WorkVisitBooking } from "@/lib/busy";

type Client = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

async function safe<T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await query;
    return data ?? [];
  } catch {
    return [];
  }
}

/**
 * Everything that makes anybody unavailable, from every source at once.
 *
 * The three reads are deliberately unconditional rather than filtered to a
 * person: a booking page asks about a dozen evaluators, and a dozen filtered
 * queries is slower than three unfiltered ones over a business this size. The
 * filtering happens in memory, where it is also easier to be sure it is right.
 *
 * Work sessions are the source that never used to be consulted, and the reason
 * the booking page could offer a ten o'clock slot to somebody who had been on
 * a patio install since eight.
 */
export async function loadBusyBlocks(client: Client): Promise<BusyBlock[]> {
  const [evaluationRows, sessionRows, crewRows, jobRows, timeOffRows] = await Promise.all([
    safe(
      client
        .from("jobs")
        .select("id, assigned_to, evaluation_date, evaluation_end_date, evaluation_status, status, properties(address)")
        .not("evaluation_date", "is", null)
    ),
    safe(client.from("job_work_sessions").select("id, job_id, starts_on, ends_on, status")),
    safe(client.from("job_crew").select("job_id, profile_id")),
    safe(client.from("jobs").select("id, assigned_to, status, properties(address)")),
    safe(client.from("availability_days_off").select("profile_id, date, start_time, end_time")),
  ]);

  const evaluations: EvaluationBooking[] = (
    evaluationRows as unknown as {
      id: string;
      assigned_to: string | null;
      evaluation_date: string | null;
      evaluation_end_date: string | null;
      evaluation_status: string;
      status: string;
      properties: { address: string } | null;
    }[]
  ).map((j) => ({
    jobId: j.id,
    profileId: j.assigned_to,
    startIso: j.evaluation_date,
    endIso: j.evaluation_end_date,
    label: j.properties?.address ?? "an evaluation",
    cancelled: j.status === "cancelled" || j.evaluation_status === "cancelled",
  }));

  const jobs = new Map(
    (jobRows as unknown as { id: string; assigned_to: string | null; status: string; properties: { address: string } | null }[]).map(
      (j) => [j.id, j]
    )
  );

  // A visit blocks everybody on the job, not only whoever happens to be lead.
  // A patio crew of three is three people who cannot take an evaluation that
  // morning, and only counting the lead is how the other two got double-booked.
  const crewByJob = new Map<string, Set<string>>();
  for (const row of crewRows as unknown as { job_id: string; profile_id: string }[]) {
    const set = crewByJob.get(row.job_id) ?? new Set<string>();
    set.add(row.profile_id);
    crewByJob.set(row.job_id, set);
  }

  const visits: WorkVisitBooking[] = (
    sessionRows as unknown as { id: string; job_id: string; starts_on: string; ends_on: string; status: string }[]
  ).map((s) => {
    const job = jobs.get(s.job_id);
    const people = new Set(crewByJob.get(s.job_id) ?? []);
    if (job?.assigned_to) people.add(job.assigned_to);
    return {
      jobId: s.job_id,
      profileIds: [...people],
      startsOn: s.starts_on,
      endsOn: s.ends_on,
      label: job?.properties?.address ?? "a job",
      cancelled: s.status === "cancelled" || job?.status === "cancelled",
    };
  });

  const timeOff: TimeOffBooking[] = (
    timeOffRows as unknown as { profile_id: string; date: string; start_time: string | null; end_time: string | null }[]
  ).map((d) => ({
    profileId: d.profile_id,
    date: d.date,
    startTime: d.start_time,
    endTime: d.end_time,
  }));

  return busyBlocks({ evaluations, visits, timeOff });
}

/** For signed-in callers — respects row-level security. */
export async function getBusyBlocks(): Promise<BusyBlock[]> {
  return loadBusyBlocks(await createClient());
}

/** For the public booking page, which has no session to read with. */
export async function getBusyBlocksAsAdmin(): Promise<BusyBlock[]> {
  return loadBusyBlocks(createAdminClient());
}

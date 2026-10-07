import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { rankCrew, type CrewInput, type CrewJob, type CrewStanding } from "@/lib/crew-leaderboard";

/**
 * Every job each crew member was on, and what happened to it.
 *
 * A person is on a job when they are on its crew. The job's days come from
 * its work sessions, its return trips from its tickets, and the client's
 * word from its issues.
 */
export interface CrewBoards {
  recent: CrewStanding[];
  allTime: CrewStanding[];
}

export async function getCrewBoards(): Promise<CrewBoards> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  if (!org) return { recent: [], allTime: [] };

  const { data: crew, error } = await supabase.from("job_crew").select("job_id, profile_id, is_lead").eq("organization_id", org).limit(5000);
  if (error) throw error;
  const crewRows = (crew ?? []) as { job_id: string; profile_id: string; is_lead: boolean | null }[];
  if (crewRows.length === 0) return { recent: [], allTime: [] };
  const jobIds = [...new Set(crewRows.map((r) => r.job_id))];

  const [{ data: jobs }, { data: sessions }, { data: tickets }, { data: issues }, { data: profiles }] = await Promise.all([
    supabase.from("jobs").select("id, status, project_end_date, completed_at, property:properties(address, customer:customers(name))").in("id", jobIds),
    supabase.from("job_work_sessions").select("job_id, starts_on, ends_on, status").in("job_id", jobIds),
    supabase.from("job_tickets").select("job_id, cause").in("job_id", jobIds),
    supabase.from("job_issues").select("job_id, type").in("job_id", jobIds),
    supabase.from("profiles").select("id, full_name, email").eq("organization_id", org),
  ]);

  type JobRow = { id: string; status: string; project_end_date: string | null; completed_at: string | null; property: { address: string | null; customer: { name: string } | null } | null };
  const jobById = new Map(((jobs ?? []) as unknown as JobRow[]).map((j) => [j.id, j]));
  const sessionsByJob = new Map<string, { starts_on: string; ends_on: string; status: string }[]>();
  for (const s of (sessions ?? []) as { job_id: string; starts_on: string; ends_on: string; status: string }[]) {
    sessionsByJob.set(s.job_id, [...(sessionsByJob.get(s.job_id) ?? []), s]);
  }
  const ticketsByJob = new Map<string, { cause: string | null }[]>();
  for (const t of (tickets ?? []) as { job_id: string; cause: string | null }[]) {
    ticketsByJob.set(t.job_id, [...(ticketsByJob.get(t.job_id) ?? []), { cause: t.cause }]);
  }
  const issuesByJob = new Map<string, { type: string }[]>();
  for (const i of (issues ?? []) as { job_id: string; type: string }[]) {
    issuesByJob.set(i.job_id, [...(issuesByJob.get(i.job_id) ?? []), { type: i.type }]);
  }
  const nameOf = new Map((profiles ?? []).map((p) => [p.id, (p.full_name ?? "").trim() || (p.email ?? "").split("@")[0] || "Somebody"]));

  const byPerson = new Map<string, CrewInput>();
  for (const row of crewRows) {
    const job = jobById.get(row.job_id);
    if (!job) continue;
    const s = sessionsByJob.get(row.job_id) ?? [];
    const days = s.flatMap((x) => [x.starts_on, x.ends_on]).sort();
    const entry: CrewJob = {
      jobId: row.job_id,
      clientName: job.property?.customer?.name ?? "Client",
      address: job.property?.address ?? null,
      status: job.status,
      lead: Boolean(row.is_lead),
      sessionsScheduled: s.length,
      sessionsDone: s.filter((x) => x.status === "done").length,
      firstDay: days[0] ?? null,
      lastDay: days[days.length - 1] ?? null,
      projectEndDate: job.project_end_date,
      completedAt: job.completed_at,
      tickets: ticketsByJob.get(row.job_id) ?? [],
      issues: issuesByJob.get(row.job_id) ?? [],
    };
    const person = byPerson.get(row.profile_id) ?? { profileId: row.profile_id, name: nameOf.get(row.profile_id) ?? "Somebody", jobs: [] };
    person.jobs.push(entry);
    byPerson.set(row.profile_id, person);
  }

  const inputs = [...byPerson.values()];
  return {
    recent: rankCrew(inputs, { since: new Date(Date.now() - 90 * 86_400_000) }),
    allTime: rankCrew(inputs),
  };
}

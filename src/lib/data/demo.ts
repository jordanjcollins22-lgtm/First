import { createClient } from "@/lib/supabase/server";
import { listProfiles, listRoles } from "@/lib/data/team";
import { dateKeyIn } from "@/lib/time-zone";

/**
 * Admin > Demo: every role, the people who have it, and what each of them has
 * on their plate, so the right person can be opened to see how it looks.
 */

export interface DemoPerson {
  id: string;
  name: string;
  roles: string[];
  /** Active jobs they are on: the crew, or the one it is assigned to. */
  jobs: { id: string; client: string }[];
  /** Evaluations booked with them from today. */
  evaluations: number;
  nextEvaluation: string | null;
  /** Clients they manage. */
  clients: number;
  /** Visits on their jobs today. */
  today: number;
}

export interface DemoRole {
  name: string;
  people: DemoPerson[];
}

export async function getDemoRoles(): Promise<DemoRole[]> {
  const supabase = await createClient();
  const today = dateKeyIn(new Date());
  const [roles, profiles, { data: jobs }, { data: crew }, { data: customers }, { data: sessions }] = await Promise.all([
    listRoles().catch(() => []),
    listProfiles().catch(() => []),
    supabase
      .from("jobs")
      .select("id, status, assigned_to, evaluation_date, evaluation_status, property:properties(customer:customers(name))")
      .not("status", "in", "(cancelled,completed)"),
    supabase.from("job_crew").select("job_id, profile_id"),
    supabase.from("customers").select("account_manager_id").not("account_manager_id", "is", null),
    supabase.from("job_work_sessions").select("job_id").lte("starts_on", today).gte("ends_on", today).not("status", "in", "(cancelled,done)"),
  ]);

  type JobRow = { id: string; status: string; assigned_to: string | null; evaluation_date: string | null; evaluation_status: string | null; property: { customer: { name: string } | null } | null };
  const jobRows = (jobs ?? []) as unknown as JobRow[];
  const jobById = new Map(jobRows.map((j) => [j.id, j]));
  const crewOf = new Map<string, Set<string>>();
  for (const row of (crew ?? []) as { job_id: string; profile_id: string }[]) {
    if (!jobById.has(row.job_id)) continue;
    crewOf.set(row.profile_id, (crewOf.get(row.profile_id) ?? new Set()).add(row.job_id));
  }
  const clientsOf = new Map<string, number>();
  for (const c of (customers ?? []) as { account_manager_id: string }[]) clientsOf.set(c.account_manager_id, (clientsOf.get(c.account_manager_id) ?? 0) + 1);
  const visitingToday = new Set(((sessions ?? []) as { job_id: string }[]).map((s) => s.job_id));

  const people: DemoPerson[] = profiles.map((p) => {
    const mine = new Set(crewOf.get(p.id) ?? []);
    for (const j of jobRows) if (j.assigned_to === p.id && j.status !== "estimating" && j.status !== "quoted") mine.add(j.id);
    const evals = jobRows
      .filter((j) => j.assigned_to === p.id && j.evaluation_date && j.evaluation_date.slice(0, 10) >= today && j.evaluation_status !== "completed" && j.evaluation_status !== "cancelled")
      .map((j) => j.evaluation_date!)
      .sort();
    return {
      id: p.id,
      name: p.full_name || p.email,
      roles: p.roles,
      jobs: [...mine].map((id) => ({ id, client: jobById.get(id)?.property?.customer?.name ?? "A client" })),
      evaluations: evals.length,
      nextEvaluation: evals[0] ?? null,
      clients: clientsOf.get(p.id) ?? 0,
      today: [...mine].filter((id) => visitingToday.has(id)).length,
    };
  });

  const names = [...new Set([...roles.map((r) => r.name), ...profiles.flatMap((p) => p.roles)])];
  return names.map((name) => ({
    name,
    people: people.filter((p) => p.roles.includes(name)).sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

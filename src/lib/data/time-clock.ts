import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import type { Person, TimeEntry } from "@/lib/time-clock";

const SELECT =
  "id, profile_id, job_id, clocked_in_at, clocked_out_at, note, edited_by, " +
  "profiles:profile_id(full_name, email), editor:edited_by(full_name, email), jobs(name)";

interface Row {
  id: string;
  profile_id: string;
  job_id: string | null;
  clocked_in_at: string;
  clocked_out_at: string | null;
  note: string | null;
  profiles: { full_name: string | null; email: string | null } | null;
  editor: { full_name: string | null; email: string | null } | null;
  jobs: { name: string | null } | null;
}

function toEntry(row: Row): TimeEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    personName: row.profiles?.full_name || row.profiles?.email || "Someone",
    jobId: row.job_id,
    jobName: row.jobs?.name ?? null,
    clockedInAt: row.clocked_in_at,
    clockedOutAt: row.clocked_out_at,
    note: row.note,
    editedByName: row.editor?.full_name || row.editor?.email || null,
  };
}

/**
 * Everything logged on one day, plus anybody still on the clock from before
 * it.
 *
 * The overnight case is not a curiosity: somebody who forgot to clock out
 * last night is the single most common thing this screen exists to catch, and
 * a day-bounded query is exactly the query that hides them.
 */
export async function listDayEntries(day: string): Promise<TimeEntry[]> {
  const supabase = await createClient();

  const start = `${day}T00:00:00`;
  const end = `${day}T23:59:59.999`;

  const [onDay, stillOpen] = await Promise.all([
    supabase.from("time_entries").select(SELECT).gte("clocked_in_at", start).lte("clocked_in_at", end),
    supabase.from("time_entries").select(SELECT).is("clocked_out_at", null),
  ]);

  if (isMissingTable(onDay.error) || onDay.error) return [];

  const byId = new Map<string, Row>();
  for (const row of [...((onDay.data ?? []) as unknown as Row[]), ...((stillOpen.data ?? []) as unknown as Row[])]) {
    byId.set(row.id, row);
  }

  return [...byId.values()].map(toEntry).sort((a, b) => a.clockedInAt.localeCompare(b.clockedInAt));
}

/** Pay type and rate for everybody, so a day can be priced. */
export async function listPayPeople(): Promise<Person[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, pay_type, pay_rate_per_hour");

  if (isMissingTable(error) || error) return [];

  return ((data ?? []) as unknown as {
    id: string;
    full_name: string | null;
    email: string | null;
    pay_type: string | null;
    pay_rate_per_hour: number | null;
  }[]).map((row) => ({
    id: row.id,
    name: row.full_name || row.email || "Someone",
    payType: (row.pay_type as Person["payType"]) ?? "hourly",
    payRatePerHour: row.pay_rate_per_hour != null ? Number(row.pay_rate_per_hour) : null,
  }));
}

/** The signed-in person's own open entry, if they are on the clock. */
export async function myOpenEntry(profileId: string): Promise<TimeEntry | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("time_entries")
    .select(SELECT)
    .eq("profile_id", profileId)
    .is("clocked_out_at", null)
    .order("clocked_in_at", { ascending: false })
    .limit(1);

  if (isMissingTable(error) || error || !data?.length) return null;
  return toEntry(data[0] as unknown as Row);
}

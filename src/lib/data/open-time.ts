import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { openBlocks, scoreDay, workingWindow, type Appointment, type DayScore, type OpenBlock, type OutreachCounts } from "@/lib/open-time";
import { zonedToUtc } from "@/lib/time-zone";

type Client = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

export interface PersonOpenTime {
  profileId: string;
  name: string;
  email: string | null;
  day: string;
  appointments: Appointment[];
  blocks: OpenBlock[];
  today: OutreachCounts;
  score: DayScore;
  /** The last seven days, ending yesterday. */
  week: { openMinutes: number; counts: OutreachCounts; score: DayScore };
}

function emptyCounts(): OutreachCounts {
  return { comments: 0, dms: 0, posts: 0, links: 0, bookings: 0 };
}

async function outreachBetween(client: Client, profileId: string, from: Date, to: Date): Promise<OutreachCounts> {
  const { data: links } = await client
    .from("outreach_links")
    .select("code, kind, created_at")
    .eq("profile_id", profileId)
    .gte("created_at", from.toISOString())
    .lt("created_at", to.toISOString());
  const counts = emptyCounts();
  const codes: string[] = [];
  for (const l of (links ?? []) as { code: string; kind: string }[]) {
    codes.push(l.code);
    if (l.kind === "comment") counts.comments += 1;
    else if (l.kind === "dm") counts.dms += 1;
    else if (l.kind === "post") counts.posts += 1;
    else counts.links += 1;
  }
  // Every link is a link sent; comments and messages carry one each.
  counts.links += counts.comments + counts.dms + counts.posts;

  const { data: allCodes } = await client.from("outreach_links").select("code").eq("profile_id", profileId);
  const mine = ((allCodes ?? []) as { code: string }[]).map((c) => c.code);
  if (mine.length > 0) {
    const { count } = await client
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .in("referral_code", mine)
      .gte("created_at", from.toISOString())
      .lt("created_at", to.toISOString());
    counts.bookings = count ?? 0;
  }
  return counts;
}

async function appointmentsOn(client: Client, profileId: string, day: string): Promise<Appointment[]> {
  const window = workingWindow(day);
  const { data } = await client
    .from("jobs")
    .select("evaluation_date, evaluation_end_date, property:properties(address, customers(name))")
    .eq("assigned_to", profileId)
    .neq("evaluation_status", "cancelled")
    .neq("status", "cancelled")
    .gte("evaluation_date", new Date(window.start.getTime() - 6 * 3_600_000).toISOString())
    .lte("evaluation_date", window.end.toISOString());
  type Row = { evaluation_date: string; evaluation_end_date: string | null; property: { address: string; customers: { name: string } | null } | null };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    startsAt: r.evaluation_date,
    endsAt: r.evaluation_end_date,
    label: r.property?.customers?.name ?? r.property?.address ?? "an evaluation",
  }));
}

export async function personOpenTime(
  client: Client,
  person: { id: string; name: string; email: string | null },
  day: string
): Promise<PersonOpenTime> {
  const window = workingWindow(day);
  const appointments = await appointmentsOn(client, person.id, day);
  const blocks = openBlocks(appointments, window);
  const openMinutes = blocks.reduce((s, b) => s + b.minutes, 0);
  const today = await outreachBetween(client, person.id, window.start, window.end);

  // The week before today: open time is added up day by day, actions once.
  const weekStart = zonedToUtc(shiftDay(day, -7), "00:00");
  const weekEnd = zonedToUtc(day, "00:00");
  let weekOpen = 0;
  for (let i = 1; i <= 7; i += 1) {
    const d = shiftDay(day, -i);
    const w = workingWindow(d);
    const dow = new Date(w.start).getUTCDay();
    if (dow === 0) continue; // Sundays are not open time.
    weekOpen += openBlocks(await appointmentsOn(client, person.id, d), w).reduce((s, b) => s + b.minutes, 0);
  }
  const weekCounts = await outreachBetween(client, person.id, weekStart, weekEnd);

  return {
    profileId: person.id,
    name: person.name,
    email: person.email,
    day,
    appointments,
    blocks,
    today,
    score: scoreDay(openMinutes, today),
    week: { openMinutes: weekOpen, counts: weekCounts, score: scoreDay(weekOpen, weekCounts) },
  };
}

function shiftDay(day: string, by: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
}

/** The people whose open time is worth counting: evaluators and account managers. */
export async function sellingTeam(client: Client, organizationId: string): Promise<{ id: string; name: string; email: string | null }[]> {
  const { data: profiles } = await client
    .from("profiles")
    .select("id, full_name, email, does_evaluations, profile_roles(role_name)")
    .eq("organization_id", organizationId);
  type Row = { id: string; full_name: string | null; email: string | null; does_evaluations: boolean | null; profile_roles: { role_name: string }[] | null };
  return ((profiles ?? []) as unknown as Row[])
    .filter((p) => {
      const roles = (p.profile_roles ?? []).map((r) => r.role_name.toLowerCase());
      return p.does_evaluations || roles.includes("account manager") || roles.includes("evaluator");
    })
    .map((p) => ({ id: p.id, name: p.full_name || p.email || "Someone", email: p.email }));
}

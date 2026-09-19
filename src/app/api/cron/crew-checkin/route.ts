import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { notifyTeamMember } from "@/lib/notifications";
import { presenceOf, quietLine } from "@/lib/crew-presence";
import { dateKeyIn } from "@/lib/time-zone";
import { log } from "@/lib/log";

/**
 * The morning check: who is on today's jobs and has not opened the app.
 *
 * Runs once after the trucks should have left. For each crew member on a
 * visit today with no tap, no load-out tick and no position today, the
 * owners get one text naming them and their first stop. Once a day per
 * person, so a quiet morning is one message and not a drip.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = authorizeCron(request, "crew-checkin");
  if (refused) return refused;

  const admin = createAdminClient();
  const now = new Date();
  const day = dateKeyIn(now);

  const { data: sessions } = await admin
    .from("job_work_sessions")
    .select("job_id, organization_id, stop_order, jobs(status, properties(customers(name)))")
    .lte("starts_on", day)
    .gte("ends_on", day)
    .not("status", "in", "(cancelled,done)");
  type SessionRow = { job_id: string; organization_id: string; stop_order: number | null; jobs: { status: string; properties: { customers: { name: string } | null } | null } | null };
  const live = ((sessions ?? []) as unknown as SessionRow[]).filter((s) => s.jobs && s.jobs.status !== "cancelled" && s.jobs.status !== "completed");
  if (live.length === 0) return NextResponse.json({ day, checked: 0, quiet: 0 });

  const jobIds = [...new Set(live.map((s) => s.job_id))];
  const [{ data: crewRows }, { data: events }, { data: checks }, { data: positions }, { data: owners }] = await Promise.all([
    admin.from("job_crew").select("job_id, profile_id, organization_id, profiles!job_crew_profile_id_fkey(full_name, email)").in("job_id", jobIds),
    admin.from("crew_day_events").select("profile_id").eq("day", day),
    admin.from("loadout_checks").select("profile_id").eq("day", day),
    admin.from("crew_positions").select("profile_id, at"),
    admin.from("profile_roles").select("profile_id, role_name").in("role_name", ["owner", "admin"]),
  ]);

  const count = (rows: { profile_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.profile_id, (m.get(r.profile_id) ?? 0) + 1);
    return m;
  };
  const eventsBy = count(events);
  const checksBy = count(checks);
  const positionAt = new Map((positions ?? []).map((p) => [p.profile_id, p.at as string]));

  // First stop by stop order, so the text says where they should be.
  const firstStopByJob = new Map<string, { order: number; name: string }>();
  for (const s of live) {
    firstStopByJob.set(s.job_id, { order: s.stop_order ?? Number.MAX_SAFE_INTEGER, name: s.jobs?.properties?.customers?.name ?? "a job" });
  }

  type CrewRow = { job_id: string; profile_id: string; organization_id: string; profiles: { full_name: string | null; email: string } | null };
  const people = new Map<string, { name: string; organizationId: string; stops: { order: number; name: string }[] }>();
  for (const c of (crewRows ?? []) as unknown as CrewRow[]) {
    const p = people.get(c.profile_id) ?? { name: c.profiles?.full_name || c.profiles?.email || "Someone", organizationId: c.organization_id, stops: [] };
    const stop = firstStopByJob.get(c.job_id);
    if (stop) p.stops.push(stop);
    people.set(c.profile_id, p);
  }

  let quiet = 0;
  let sent = 0;
  for (const [profileId, p] of people) {
    const presence = presenceOf({ day, eventsToday: eventsBy.get(profileId) ?? 0, checksToday: checksBy.get(profileId) ?? 0, positionAt: positionAt.get(profileId) ?? null }, now);
    if (!presence.quiet) continue;
    quiet++;
    const first = [...p.stops].sort((a, b) => a.order - b.order)[0]?.name ?? null;
    const line = quietLine(p.name.split(" ")[0] || p.name, first);
    for (const owner of owners ?? []) {
      if (owner.profile_id === profileId) continue;
      const ok = await notifyTeamMember(owner.profile_id, "team_messages", line, { dedupeKey: `crew-quiet:${profileId}:${day}` }).catch(() => false);
      if (ok) sent++;
    }
    log.info("crew.quiet", { profileId, day, firstStop: first });
  }

  return NextResponse.json({ day, checked: people.size, quiet, sent });
}

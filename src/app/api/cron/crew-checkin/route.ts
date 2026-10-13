import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeScheduledCall } from "@/lib/cron-auth";
import { notifyTeamMember } from "@/lib/notifications";
import { presenceOf, quietLine } from "@/lib/crew-presence";
import { dateKeyIn, minutesIn } from "@/lib/time-zone";
import { outboundBaseUrl } from "@/lib/base-url";
import { log } from "@/lib/log";
import { CHECKIN_WINDOW_END_MINUTES, escalationLine, leadAlertLine, routeAlert, shouldEscalate } from "@/lib/ops/checkin-escalation";
import { allOrganizationIds, ensureSettings, ownerIdsFor, untyped } from "@/lib/data/ops-settings";

/**
 * The morning check: who is on today's jobs and has not opened the app.
 *
 * Each business on its own. It used to read every business's crew and text
 * every owner and admin in the database, so one company's owner could hear
 * about another's crew. Now everything is filtered to the business.
 *
 * With "lead first" on (the default), the job's project lead hears first,
 * with a link to say "on it". If nobody acknowledges within the escalation
 * window (30 minutes by default) the owners hear. If the quiet person is the
 * lead, or the job has no lead, the owners hear straight away. Turning it off
 * puts back the old behaviour: owners only, once.
 *
 * Safe to run every 15 minutes: each person is alerted once a day, each
 * alert escalates once, and nobody is chased after midday.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = await authorizeScheduledCall(request, "crew-checkin");
  if (refused) return refused;

  const now = new Date();
  const day = dateKeyIn(now);
  const results: Record<string, unknown>[] = [];
  let base: string | null = null;
  try {
    base = await outboundBaseUrl();
  } catch {
    base = null;
  }

  for (const organizationId of await allOrganizationIds()) {
    try {
      results.push({ organizationId, ...(await checkOrganization(organizationId, day, now, base)) });
    } catch (err) {
      log.error("crew.checkin_failed", err, { organizationId });
    }
  }
  return NextResponse.json({ day, results });
}

async function checkOrganization(organizationId: string, day: string, now: Date, base: string | null) {
  const admin = createAdminClient();
  const db = untyped(admin);
  const { settings, ready } = await ensureSettings(organizationId);
  const leadFirst = ready && settings.checkinLeadFirstEnabled;

  // Escalations and resolutions run whatever the time, so an alert sent at
  // 11:50 still escalates at 12:20.
  const escalated = leadFirst ? await escalate(organizationId, day, now, settings.checkinEscalateMinutes) : 0;

  if (minutesIn(now) >= CHECKIN_WINDOW_END_MINUTES) return { checked: 0, quiet: 0, sent: 0, escalated };

  const { data: sessions } = await admin
    .from("job_work_sessions")
    .select("job_id, organization_id, stop_order, jobs(status, properties(customers(name)))")
    .eq("organization_id", organizationId)
    .lte("starts_on", day)
    .gte("ends_on", day)
    .not("status", "in", "(cancelled,done)");
  type SessionRow = { job_id: string; organization_id: string; stop_order: number | null; jobs: { status: string; properties: { customers: { name: string } | null } | null } | null };
  const live = ((sessions ?? []) as unknown as SessionRow[]).filter((s) => s.jobs && s.jobs.status !== "cancelled" && s.jobs.status !== "completed");
  if (live.length === 0) return { checked: 0, quiet: 0, sent: 0, escalated };

  const jobIds = [...new Set(live.map((s) => s.job_id))];
  const [{ data: crewRows }, { data: events }, { data: checks }, { data: positions }, owners] = await Promise.all([
    admin
      .from("job_crew")
      .select("job_id, profile_id, is_lead, organization_id, profiles!job_crew_profile_id_fkey(full_name, email)")
      .eq("organization_id", organizationId)
      .in("job_id", jobIds),
    admin.from("crew_day_events").select("profile_id").eq("organization_id", organizationId).eq("day", day),
    admin.from("loadout_checks").select("profile_id").eq("organization_id", organizationId).eq("day", day),
    admin.from("crew_positions").select("profile_id, at").eq("organization_id", organizationId),
    ownerIdsFor(organizationId),
  ]);

  const count = (rows: { profile_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.profile_id, (m.get(r.profile_id) ?? 0) + 1);
    return m;
  };
  const eventsBy = count(events);
  const checksBy = count(checks);
  const positionAt = new Map((positions ?? []).map((p) => [p.profile_id, p.at as string]));

  const firstStopByJob = new Map<string, { order: number; name: string }>();
  for (const s of live) {
    firstStopByJob.set(s.job_id, { order: s.stop_order ?? Number.MAX_SAFE_INTEGER, name: s.jobs?.properties?.customers?.name ?? "a job" });
  }

  type CrewRow = { job_id: string; profile_id: string; is_lead: boolean; profiles: { full_name: string | null; email: string } | null };
  const rows = (crewRows ?? []) as unknown as CrewRow[];
  const leadOf = new Map(rows.filter((r) => r.is_lead).map((r) => [r.job_id, r.profile_id]));
  const nameOf = new Map(rows.map((r) => [r.profile_id, r.profiles?.full_name || r.profiles?.email || "Someone"]));
  const people = new Map<string, { name: string; stops: { order: number; name: string; jobId: string }[] }>();
  for (const c of rows) {
    const p = people.get(c.profile_id) ?? { name: nameOf.get(c.profile_id) ?? "Someone", stops: [] };
    const stop = firstStopByJob.get(c.job_id);
    if (stop) p.stops.push({ ...stop, jobId: c.job_id });
    people.set(c.profile_id, p);
  }

  // Anybody alerted earlier who has since shown up: the alert is settled.
  if (leadFirst) {
    const seen = [...people.keys()].filter((id) => (eventsBy.get(id) ?? 0) > 0 || (checksBy.get(id) ?? 0) > 0);
    if (seen.length > 0) {
      await db.from("crew_checkin_alerts").update({ resolved_at: now.toISOString() }).eq("organization_id", organizationId).eq("day", day).in("profile_id", seen).is("resolved_at", null);
    }
  }

  let quiet = 0;
  let sent = 0;
  for (const [profileId, p] of people) {
    const presence = presenceOf({ day, eventsToday: eventsBy.get(profileId) ?? 0, checksToday: checksBy.get(profileId) ?? 0, positionAt: positionAt.get(profileId) ?? null }, now);
    if (!presence.quiet) continue;
    quiet++;
    const first = [...p.stops].sort((a, b) => a.order - b.order)[0] ?? null;
    const shortName = p.name.split(" ")[0] || p.name;

    if (!leadFirst) {
      for (const owner of owners) {
        if (owner === profileId) continue;
        const ok = await notifyTeamMember(owner, "team_messages", quietLine(shortName, first?.name ?? null), { dedupeKey: `crew-quiet:${profileId}:${day}` }).catch(() => false);
        if (ok) sent++;
      }
      continue;
    }

    const leadId = first ? (leadOf.get(first.jobId) ?? null) : null;
    const route = routeAlert({ quietId: profileId, leadId, ownerIds: owners });
    // One alert per person per day, claimed before anybody is texted.
    const { data: claimed, error } = await db
      .from("crew_checkin_alerts")
      .insert({ organization_id: organizationId, day, profile_id: profileId, job_id: first?.jobId ?? null, lead_id: route.skippedLead ? null : leadId, alerted_to: route.first })
      .select("token")
      .maybeSingle();
    if (error || !claimed) continue;
    const ack = base && !route.skippedLead ? `${base}/api/ops/checkin-ack/${(claimed as { token: string }).token}` : null;
    const line = route.skippedLead ? quietLine(shortName, first?.name ?? null) : leadAlertLine(shortName, first?.name ?? null, ack);
    for (const to of route.first) {
      const ok = await notifyTeamMember(to, "team_messages", line, { dedupeKey: `crew-quiet:${profileId}:${day}:${to}` }).catch(() => false);
      if (ok) sent++;
    }
    log.info("crew.quiet", { organizationId, profileId, day, firstStop: first?.name ?? null, to: route.skippedLead ?? "lead" });
  }

  return { checked: people.size, quiet, sent, escalated };
}

/** Alerts the lead has not answered in time go to the owners, once. */
async function escalate(organizationId: string, day: string, now: Date, minutes: number): Promise<number> {
  const db = untyped(createAdminClient());
  const { data } = await db
    .from("crew_checkin_alerts")
    .select("id, profile_id, lead_id, alerted_at, acknowledged_at, escalated_at, resolved_at")
    .eq("organization_id", organizationId)
    .eq("day", day)
    .not("lead_id", "is", null)
    .is("acknowledged_at", null)
    .is("escalated_at", null)
    .is("resolved_at", null);
  const due = ((data ?? []) as {
    id: string;
    profile_id: string;
    lead_id: string;
    alerted_at: string;
    acknowledged_at: string | null;
    escalated_at: string | null;
    resolved_at: string | null;
  }[]).filter((a) => shouldEscalate({ alertedAt: a.alerted_at, acknowledgedAt: a.acknowledged_at, escalatedAt: a.escalated_at, resolvedAt: a.resolved_at }, now, minutes));
  if (due.length === 0) return 0;

  const owners = await ownerIdsFor(organizationId);
  const ids = [...new Set(due.flatMap((a) => [a.profile_id, a.lead_id]))];
  const { data: profiles } = await db.from("profiles").select("id, full_name, email").in("id", ids);
  const name = new Map(((profiles ?? []) as { id: string; full_name: string | null; email: string }[]).map((p) => [p.id, (p.full_name || p.email || "Someone").split(" ")[0]]));

  let count = 0;
  for (const a of due) {
    // Claimed first, so two overlapping runs escalate once.
    const { data: claimed } = await db
      .from("crew_checkin_alerts")
      .update({ escalated_at: now.toISOString() })
      .eq("id", a.id)
      .is("escalated_at", null)
      .is("acknowledged_at", null)
      .select("id");
    if (!claimed || (claimed as unknown[]).length === 0) continue;
    const line = escalationLine(name.get(a.profile_id) ?? "Someone", name.get(a.lead_id) ?? null, minutes);
    for (const owner of owners) {
      if (owner === a.profile_id || owner === a.lead_id) continue;
      await notifyTeamMember(owner, "team_messages", line, { dedupeKey: `crew-quiet-escalated:${a.id}:${owner}` }).catch(() => false);
    }
    count++;
  }
  return count;
}

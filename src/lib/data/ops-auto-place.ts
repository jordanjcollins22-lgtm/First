import type { SupabaseClient } from "@supabase/supabase-js";

import { budgetFromEstimate } from "@/lib/project-review";
import type { JobEstimate } from "@/lib/job-estimate";
import { roleKeysOf } from "@/lib/roles";
import { embedded } from "@/lib/postgrest";
import { fetchForecasts, isRoughDay, describeWeather } from "@/lib/weather";
import { dateKeyIn, weekdayDate } from "@/lib/time-zone";
import { suggestSchedule, HORIZON_DAYS, type DayCapacity, type SchedulableJob } from "@/lib/schedule-engine";
import { decidePlacement, placeInOrder, placementNotice, type PlacementDecision } from "@/lib/ops/auto-place";
import { addDays } from "@/lib/ops/crew-bonus";
import { contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";
import { log } from "@/lib/log";
import { admin, ensureSettings } from "@/lib/data/ops-settings";

/**
 * Auto-placement, run for one business.
 *
 * Gathers what the schedule engine needs with the service role (the engine's
 * own data layer reads as the signed-in user, and a cron has none), asks the
 * engine for each job's best day one job at a time, and then either books it
 * or holds it. Only jobs sold after auto-placement went live are considered,
 * at most `auto_place_daily_cap` a day, never sooner than the notice period,
 * and never a job that already has a work day.
 *
 * "Ready" here is the cheap, certain part of the readiness checklist: sold,
 * no blocking issue open, no field exception stopping work, the deposit in if
 * one is due, and hours known. The full checklist (materials, access, ...)
 * still runs on the board before the start date; a job placed now has that
 * notice period for it.
 */

const WEATHER_STOPS = ["grading", "hardscape", "patio", "planting", "sod", "seeding", "mulch", "drainage"];
const SOURCE_NOTE = "Placed automatically";

export interface AutoPlaceResult {
  considered: number;
  placed: number;
  held: number;
  capped: boolean;
}

type JobRow = {
  id: string;
  name: string;
  created_at: string;
  property: { address: string | null; lat: number | null; lng: number | null; customers: { id: string; name: string | null; organization_id: string } | null } | null;
  job_requested_services?: { service_type_id: string }[] | null;
  job_proposals?:
    | { status: string; client_chosen_day: string | null; responded_at: string | null; approved_at: string | null; estimate: unknown }[]
    | { status: string; client_chosen_day: string | null; responded_at: string | null; approved_at: string | null; estimate: unknown }
    | null;
};

export async function gatherPlacements(organizationId: string, client: SupabaseClient, minNoticeDays: number, now: Date) {
  const today = dateKeyIn(now);
  const firstDay = addDays(today, minNoticeDays);
  const lastDay = addDays(today, HORIZON_DAYS);

  const [jobsRes, sessionsRes, issuesRes, exceptionsRes, placementsRes, peopleRes, weeklyRes, offRes, locationsRes] = await Promise.all([
    client
      .from("jobs")
      .select(
        "id, name, created_at, property:properties!inner(address, lat, lng, customers!inner(id, name, organization_id)), job_requested_services(service_type_id), job_proposals(status, client_chosen_day, responded_at, approved_at, estimate)"
      )
      .eq("status", "approved")
      .is("declined_at", null)
      .limit(300),
    client.from("job_work_sessions").select("job_id, starts_on, ends_on, status").eq("organization_id", organizationId).neq("status", "cancelled").gte("ends_on", today),
    client.from("job_issues").select("job_id").eq("organization_id", organizationId).eq("status", "open").eq("blocking", true),
    client.from("job_exceptions").select("job_id").eq("organization_id", organizationId).in("state", ["reported", "acknowledged"]).eq("blocks_work", true),
    client.from("auto_placements").select("job_id, status").eq("organization_id", organizationId),
    client.from("profiles").select("id, full_name, email").eq("organization_id", organizationId),
    client.from("availability_weekly").select("profile_id, day_of_week, start_time, end_time").eq("organization_id", organizationId),
    client.from("availability_days_off").select("profile_id, date").eq("organization_id", organizationId).gte("date", today).lte("date", lastDay),
    client.from("business_locations").select("id, name, lat, lng").eq("organization_id", organizationId),
  ]);

  const jobs = ((jobsRes.data ?? []) as unknown as JobRow[]).filter((j) => j.property?.customers?.organization_id === organizationId);
  const sessions = (sessionsRes.data ?? []) as { job_id: string; starts_on: string; ends_on: string; status: string }[];
  const anySession = new Set(sessions.map((s) => s.job_id));
  // A job already on the calendar, or one somebody dismissed from auto-placement, is not ours.
  const decided = new Set(((placementsRes.data ?? []) as { job_id: string; status: string }[]).filter((p) => p.status !== "held").map((p) => p.job_id));
  const blocked = new Set([
    ...((issuesRes.data ?? []) as { job_id: string }[]).map((r) => r.job_id),
    ...((exceptionsRes.data ?? []) as { job_id: string }[]).map((r) => r.job_id),
  ]);

  const wanting = jobs.filter((j) => !anySession.has(j.id) && !decided.has(j.id));
  const wantingIds = wanting.map((j) => j.id);

  // Deposits: a plan that asks for one must have it in before a date is promised.
  const [plansRes, paidRes] = wantingIds.length
    ? await Promise.all([
        client.from("payment_plans").select("job_id, deposit_cents, status").in("job_id", wantingIds).in("status", ["accepted", "active", "settled"]),
        client.from("payments").select("job_id, amount_cents").in("job_id", wantingIds),
      ])
    : [{ data: [] }, { data: [] }];
  const paid = new Map<string, number>();
  for (const p of (paidRes.data ?? []) as { job_id: string; amount_cents: number | null }[]) paid.set(p.job_id, (paid.get(p.job_id) ?? 0) + Number(p.amount_cents ?? 0));
  const depositShort = new Set(
    ((plansRes.data ?? []) as { job_id: string; deposit_cents: number | null }[])
      .filter((p) => Number(p.deposit_cents ?? 0) > 0 && (paid.get(p.job_id) ?? 0) < Number(p.deposit_cents))
      .map((p) => p.job_id)
  );

  // ------------------------------------------------------------------ crew
  const people = (peopleRes.data ?? []) as { id: string; full_name: string | null; email: string | null }[];
  const { data: roleRows } = people.length
    ? await client.from("profile_roles").select("profile_id, role_name").in("profile_id", people.map((p) => p.id))
    : { data: [] };
  const rolesBy = new Map<string, string[]>();
  for (const r of (roleRows ?? []) as { profile_id: string; role_name: string }[]) rolesBy.set(r.profile_id, [...(rolesBy.get(r.profile_id) ?? []), r.role_name]);
  const field = people.filter((p) => {
    const keys = roleKeysOf(rolesBy.get(p.id) ?? []);
    return keys.includes("project-technician") || keys.includes("project-lead");
  });

  const weekly = new Map<string, Map<number, number>>();
  for (const w of (weeklyRes.data ?? []) as { profile_id: string; day_of_week: number; start_time: string; end_time: string }[]) {
    const hours = Math.max(0, (Date.parse(`1970-01-01T${w.end_time}Z`) - Date.parse(`1970-01-01T${w.start_time}Z`)) / 3_600_000);
    const m = weekly.get(w.profile_id) ?? new Map<number, number>();
    m.set(w.day_of_week, hours);
    weekly.set(w.profile_id, m);
  }
  const off = new Set(((offRes.data ?? []) as { profile_id: string; date: string }[]).map((d) => `${d.profile_id}|${d.date}`));

  const sessionJobIds = [...new Set(sessions.map((s) => s.job_id))];
  const { data: crewRows } = sessionJobIds.length ? await client.from("job_crew").select("job_id, profile_id").in("job_id", sessionJobIds) : { data: [] };
  const crewByJob = new Map<string, string[]>();
  for (const c of (crewRows ?? []) as { job_id: string; profile_id: string }[]) crewByJob.set(c.job_id, [...(crewByJob.get(c.job_id) ?? []), c.profile_id]);
  const busy = new Set<string>();
  const bookedByDate = new Map<string, string[]>();
  for (const s of sessions) {
    for (let d = s.starts_on; d <= s.ends_on; d = addDays(d, 1)) {
      for (const p of crewByJob.get(s.job_id) ?? []) busy.add(`${p}|${d}`);
      bookedByDate.set(d, [...(bookedByDate.get(d) ?? []), s.job_id]);
    }
  }

  // --------------------------------------------------------------- weather
  const rough = new Map<string, string>();
  const points = ((locationsRes.data ?? []) as { id: string; name: string; lat: number; lng: number }[]).filter((l) => l.lat != null && l.lng != null);
  let weatherKnown = points.length > 0;
  if (weatherKnown) {
    try {
      for (const loc of await fetchForecasts(points, 16)) {
        for (const d of loc.days) {
          if (isRoughDay(d) && !rough.has(d.date)) rough.set(d.date, `${describeWeather(d.code).toLowerCase()}, ${Math.round(d.precipChance)}% chance of rain`);
        }
      }
    } catch {
      weatherKnown = false;
    }
  }

  const days: DayCapacity[] = [];
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) {
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    days.push({
      date: d,
      crew: field
        .filter((p) => !off.has(`${p.id}|${d}`) && !busy.has(`${p.id}|${d}`))
        .map((p) => ({ profileId: p.id, name: p.full_name || p.email || "Somebody", freeHours: weekly.get(p.id)?.get(weekday) ?? 0 }))
        .filter((c) => c.freeHours > 0),
      booked: (bookedByDate.get(d) ?? []).map((jobId) => ({ jobId, lat: null, lng: null })),
      rough: rough.has(d),
      roughWhy: rough.get(d) ?? null,
    });
  }

  // ------------------------------------------------------------------ jobs
  const candidates = wanting.map((j) => {
    const proposals = embedded(j.job_proposals);
    const accepted = proposals.find((p) => p.status === "accepted" || p.status === "approved") ?? null;
    const budget = budgetFromEstimate((accepted?.estimate ?? null) as JobEstimate | null);
    const services = embedded(j.job_requested_services).map((s) => s.service_type_id);
    const ready = Boolean(accepted) && !blocked.has(j.id) && !depositShort.has(j.id);
    const job: SchedulableJob = {
      jobId: j.id,
      label: j.property?.address || j.name,
      crewHours: budget?.crewHours ?? 0,
      hoursKnown: Boolean(budget && budget.crewHours > 0),
      ready,
      blockingIssues: blocked.has(j.id) ? 1 : 0,
      lat: j.property?.lat ?? null,
      lng: j.property?.lng ?? null,
      clientPreferredDate: accepted?.client_chosen_day ?? null,
      soldAt: accepted?.responded_at ?? accepted?.approved_at ?? null,
      weatherSensitive: services.some((s) => WEATHER_STOPS.some((w) => s.includes(w))),
    };
    return { job, row: j };
  });

  return { today, days, candidates, weatherKnown, fieldCount: field.length };
}

export async function runAutoPlacement(organizationId: string, now: Date = new Date()): Promise<AutoPlaceResult> {
  const out: AutoPlaceResult = { considered: 0, placed: 0, held: 0, capped: false };
  const client = admin();
  const { settings, ready } = await ensureSettings(organizationId, client);
  if (!ready || !settings.autoPlaceEnabled || !settings.autoPlaceStartedAt) return out;

  await retryHeldNotices(client, organizationId).catch((err) => log.error("ops.auto_place_notice_retry_failed", err, { organizationId }));

  const today = dateKeyIn(now);
  const { data: placedToday } = await client
    .from("auto_placements")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("status", "placed")
    .gte("decided_at", `${today}T00:00:00Z`);
  let budget = settings.autoPlaceDailyCap - ((placedToday ?? []) as unknown[]).length;

  const gathered = await gatherPlacements(organizationId, client, settings.autoPlaceMinNoticeDays, now);
  const live = gathered.candidates.filter((c) => c.job.soldAt && c.job.soldAt >= settings.autoPlaceStartedAt!);
  out.considered = live.length;
  if (live.length === 0) return out;

  const results = placeInOrder(
    live.map((c) => c.job),
    gathered.days,
    gathered.today,
    (job, days, day) => suggestSchedule([job], days, day)[0] ?? null
  );

  for (const r of results) {
    const decision: PlacementDecision = decidePlacement(r.job, r.suggestion, r.covered, { liveSince: settings.autoPlaceStartedAt, soldAt: r.job.soldAt });
    if (decision.kind === "skip") continue;
    const row = live.find((c) => c.job.jobId === r.job.jobId)!.row;
    try {
      if (decision.kind === "hold") {
        await client.from("auto_placements").upsert(
          {
            organization_id: organizationId,
            job_id: r.job.jobId,
            status: "held",
            held_reason: decision.reason,
            placed_on: decision.suggestion?.date ?? null,
            crew: decision.suggestion?.crewProfileIds ?? [],
            because: decision.suggestion?.because ?? [],
            updated_at: now.toISOString(),
          },
          { onConflict: "job_id" }
        );
        out.held++;
        continue;
      }
      if (budget <= 0) {
        out.capped = true;
        continue;
      }
      await placeJob(client, organizationId, row, decision.suggestion, now);
      budget--;
      out.placed++;
    } catch (err) {
      log.error("ops.auto_place_failed", err, { organizationId, jobId: r.job.jobId });
    }
  }
  return out;
}

async function placeJob(client: SupabaseClient, organizationId: string, row: JobRow, s: { date: string; crewProfileIds: string[]; because: string[] }, now: Date) {
  // Re-checked at the last moment: if a person booked it since the read,
  // theirs stands.
  const { data: existing } = await client.from("job_work_sessions").select("id").eq("job_id", row.id).neq("status", "cancelled").limit(1).maybeSingle();
  if (existing) return;

  const { data: session, error } = await client
    .from("job_work_sessions")
    .insert({ organization_id: organizationId, job_id: row.id, starts_on: s.date, ends_on: s.date, status: "scheduled", purpose: SOURCE_NOTE })
    .select("id")
    .single();
  if (error) throw error;

  const { data: lead } = await client.from("job_crew").select("id").eq("job_id", row.id).eq("is_lead", true).maybeSingle();
  for (const [i, person] of s.crewProfileIds.entries()) {
    // Each on its own, so one person already on the job doesn't stop the rest.
    await client
      .from("job_crew")
      .insert({ organization_id: organizationId, job_id: row.id, profile_id: person, is_lead: !lead && i === 0 })
      .then(undefined, () => undefined);
  }

  const notice = await sendPlacementNotice(client, organizationId, row.id, s.date);

  await client.from("auto_placements").upsert(
    {
      organization_id: organizationId,
      job_id: row.id,
      status: "placed",
      session_id: (session as { id: string }).id,
      placed_on: s.date,
      crew: s.crewProfileIds,
      because: s.because,
      held_reason: null,
      client_notice: notice,
      decided_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: "job_id" }
  );
}

/**
 * The client hears the date. Through the one door, with consent and quiet
 * hours applied. A notice held for quiet hours is retried on the next run
 * under the same dedupe key, so it goes once.
 */
async function sendPlacementNotice(client: SupabaseClient, organizationId: string, jobId: string, date: string): Promise<string> {
  const { data: job } = await client
    .from("jobs")
    .select("property:properties(address, customers(id, name))")
    .eq("id", jobId)
    .maybeSingle();
  const property = (job as unknown as { property: { address: string | null; customers: { id: string; name: string | null } | null } | null } | null)?.property;
  const customer = property?.customers;
  if (!customer) return "No client on file";
  const [contacts, { data: org }] = await Promise.all([
    contactsFor([customer.id]),
    client.from("organizations").select("name, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", organizationId).maybeSingle(),
  ]);
  const contact = contacts.get(customer.id);
  if (!contact) return "No client on file";
  const orgRow = (org ?? {}) as { name?: string; reminder_quiet_start?: number | null; reminder_quiet_end?: number | null; reminder_time_zone?: string | null };
  const body = placementNotice({ clientName: customer.name, businessName: orgRow.name ?? "", dateLabel: weekdayDate(new Date(`${date}T16:00:00Z`)), address: property?.address ?? null });
  const outcome = await sendClientMessage(
    {
      organizationId,
      customerId: customer.id,
      channel: contact.phone ? "sms" : "email",
      basis: "service",
      kind: "job_scheduled_notice",
      referenceId: jobId,
      dedupeKey: `auto-place:${jobId}:${date}`,
      subject: "Your project is on the schedule",
      body,
      automatic: true,
    },
    contact,
    quietWindowFor(orgRow)
  );
  return outcome.sent ? "sent" : `not sent: ${outcome.reason}`;
}

/** Notices held for quiet hours, sent now if the window has opened. */
async function retryHeldNotices(client: SupabaseClient, organizationId: string): Promise<void> {
  const { data } = await client
    .from("auto_placements")
    .select("job_id, placed_on")
    .eq("organization_id", organizationId)
    .eq("status", "placed")
    .eq("client_notice", "not sent: quiet_hours")
    .limit(50);
  for (const r of (data ?? []) as { job_id: string; placed_on: string }[]) {
    const notice = await sendPlacementNotice(client, organizationId, r.job_id, r.placed_on);
    if (notice !== "not sent: quiet_hours") {
      await client.from("auto_placements").update({ client_notice: notice, updated_at: new Date().toISOString() }).eq("job_id", r.job_id);
    }
  }
}

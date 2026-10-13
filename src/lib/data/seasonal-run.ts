import type { SupabaseClient } from "@supabase/supabase-js";

import { outboundBaseUrl } from "@/lib/base-url";
import { alreadySent, contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";
import type { AutopilotSettings, StartedMap } from "@/lib/marketing/autopilot-settings";
import {
  autoStartAllowed,
  excludedBecause,
  openSeasons,
  SEASONAL_DAILY_CAP,
  seasonAudience,
  seasonalDedupeKey,
  seasonalEmail,
  seasonYear,
  type PastClient,
  type Season,
} from "@/lib/marketing/seasonal";

/**
 * The seasonal cross-sell, read and sent.
 *
 * Every email goes through sendClientMessage as a marketing send, so consent,
 * do-not-contact, quiet hours and the owner's approval policy all apply, and
 * the dedupe key 'seasonal:<season>:<year>:<customer>' makes a second send
 * to the same person in the same season impossible.
 */

const untyped = (c: unknown) => c as SupabaseClient;

/** Everyone the business has finished a job for, with what they had done. */
export async function loadPastClients(client: unknown, org: string, now = new Date()): Promise<PastClient[]> {
  const sb = untyped(client);
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, status, properties!inner(customer_id, customers!inner(id, name, email, do_not_contact, organization_id))")
    .eq("properties.customers.organization_id", org)
    .eq("status", "completed")
    .limit(5000);
  type Row = { id: string; properties: { customer_id: string; customers: { id: string; name: string | null; email: string | null; do_not_contact: boolean } | null } | null };
  const rows = (jobs ?? []) as unknown as Row[];
  const jobIds = rows.map((r) => r.id);
  const { data: requested } = jobIds.length
    ? await sb.from("job_requested_services").select("job_id, service_type_id").in("job_id", jobIds.slice(0, 3000))
    : { data: [] };
  const typeIds = [...new Set(((requested ?? []) as { service_type_id: string }[]).map((r) => r.service_type_id))];
  const { data: services } = typeIds.length ? await sb.from("services").select("service_type_id, name").eq("organization_id", org).in("service_type_id", typeIds) : { data: [] };
  const nameOf = new Map(((services ?? []) as { service_type_id: string; name: string }[]).map((s) => [s.service_type_id, s.name.toLowerCase()]));
  const servicesOfJob = new Map<string, string[]>();
  for (const r of (requested ?? []) as { job_id: string; service_type_id: string }[]) {
    const list = servicesOfJob.get(r.job_id) ?? [];
    list.push(r.service_type_id.toLowerCase(), nameOf.get(r.service_type_id) ?? "");
    servicesOfJob.set(r.job_id, list);
  }
  // Salt pre-booked since September counts as already on snow this season.
  const seasonStart = `${now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1}-09-01`;
  const { data: salt } = await sb.from("salt_orders").select("email").eq("organization_id", org).gte("created_at", seasonStart).limit(5000);
  const saltEmails = new Set(((salt ?? []) as { email: string | null }[]).map((s) => (s.email ?? "").trim().toLowerCase()).filter(Boolean));

  const by = new Map<string, PastClient>();
  for (const r of rows) {
    const c = r.properties?.customers;
    if (!c) continue;
    const pc = by.get(c.id) ?? {
      customerId: c.id,
      name: c.name,
      email: c.email,
      completedJobs: 0,
      services: [],
      hasSnowThisSeason: Boolean(c.email && saltEmails.has(c.email.trim().toLowerCase())),
      doNotContact: Boolean(c.do_not_contact),
    };
    pc.completedJobs++;
    pc.services.push(...(servicesOfJob.get(r.id) ?? []).filter(Boolean));
    by.set(c.id, pc);
  }
  return [...by.values()];
}

export interface SeasonPreview {
  season: Season;
  year: number;
  audience: number;
  excluded: { reason: string; count: number }[];
  sample: { subject: string; body: string } | null;
  run: { status: string; sent: number; skipped: number; audience: number; startedAt: string } | null;
}

async function business(sb: SupabaseClient, org: string) {
  const { data } = await sb.from("organizations").select("name, business_phone, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", org).maybeSingle();
  return data as { name: string; business_phone: string | null; reminder_quiet_start: number | null; reminder_quiet_end: number | null; reminder_time_zone: string | null } | null;
}

function bookUrl(base: string, season: Season): string {
  return `${base.replace(/\/$/, "")}/book?utm_source=email&utm_medium=seasonal&utm_campaign=${season}`;
}

export async function previewSeason(client: unknown, org: string, season: Season, now = new Date()): Promise<SeasonPreview> {
  const sb = untyped(client);
  const year = seasonYear(now);
  const [clients, biz, { data: run }] = await Promise.all([
    loadPastClients(client, org, now),
    business(sb, org),
    sb.from("seasonal_campaign_runs").select("status, sent, skipped, audience, started_at").eq("organization_id", org).eq("season", season).eq("year", year).maybeSingle(),
  ]);
  const audience = seasonAudience(season, clients);
  const reasons = new Map<string, number>();
  for (const c of clients) {
    const why = excludedBecause(season, c);
    if (why) reasons.set(why, (reasons.get(why) ?? 0) + 1);
  }
  const base = await outboundBaseUrl();
  const r = run as { status: string; sent: number; skipped: number; audience: number; started_at: string } | null;
  return {
    season,
    year,
    audience: audience.length,
    excluded: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    sample: audience[0] ? seasonalEmail(season, audience[0], { name: biz?.name ?? "JS Landscaping", phone: biz?.business_phone ?? null }, bookUrl(base, season)) : null,
    run: r ? { status: r.status, sent: r.sent, skipped: r.skipped, audience: r.audience, startedAt: r.started_at } : null,
  };
}

/** Starts a season's run. Once per season per year; a second start is a no-op. */
export async function startSeason(client: unknown, org: string, season: Season, mode: "owner" | "auto", by: string | null, now = new Date()): Promise<boolean> {
  const sb = untyped(client);
  const { error } = await sb.from("seasonal_campaign_runs").insert({
    organization_id: org,
    season,
    year: seasonYear(now),
    mode,
    status: "sending",
    started_by: by,
    started_at: now.toISOString(),
  });
  return !error;
}

export interface SeasonalRunResult {
  started: Season[];
  sent: number;
  skipped: number;
}

/** Starts automatic seasons that are due, then sends the next batch of every running season. */
export async function runSeasonal(
  client: unknown,
  org: string,
  autopilot: { settings: AutopilotSettings; started: StartedMap },
  now = new Date()
): Promise<SeasonalRunResult> {
  const sb = untyped(client);
  const result: SeasonalRunResult = { started: [], sent: 0, skipped: 0 };
  const { settings } = autopilot;

  for (const season of openSeasons(now)) {
    if (autoStartAllowed({ enabled: settings.enabled.seasonal_email, mode: settings.seasonalMode, goLive: settings.seasonalGoLive, season, now })) {
      if (await startSeason(client, org, season, "auto", null, now)) result.started.push(season);
    }
  }

  const { data: runs } = await sb.from("seasonal_campaign_runs").select("id, season, year, sent, skipped").eq("organization_id", org).eq("status", "sending");
  const active = (runs ?? []) as { id: string; season: Season; year: number; sent: number; skipped: number }[];
  if (active.length === 0) return result;

  const [clients, biz] = await Promise.all([loadPastClients(client, org, now), business(sb, org)]);
  if (!biz) return result;
  const window = quietWindowFor(biz);
  const base = await outboundBaseUrl();

  for (const run of active) {
    const audience = seasonAudience(run.season, clients);
    const keys = audience.map((c) => seasonalDedupeKey(run.season, run.year, c.customerId));
    const done = await alreadySent(org, keys);
    const todo = audience.filter((c) => !done.has(seasonalDedupeKey(run.season, run.year, c.customerId))).slice(0, SEASONAL_DAILY_CAP);
    const contacts = await contactsFor(todo.map((c) => c.customerId));
    let sent = 0;
    let skipped = 0;
    let held = false;
    for (const c of todo) {
      const contact = contacts.get(c.customerId);
      if (!contact) continue;
      const email = seasonalEmail(run.season, c, { name: biz.name, phone: biz.business_phone }, bookUrl(base, run.season));
      const outcome = await sendClientMessage(
        {
          organizationId: org,
          customerId: c.customerId,
          channel: "email",
          basis: "marketing",
          kind: "seasonal_cross_sell",
          referenceId: null,
          dedupeKey: seasonalDedupeKey(run.season, run.year, c.customerId),
          subject: email.subject,
          body: email.body,
          automatic: true,
        },
        contact,
        window,
        now
      );
      if (outcome.sent) sent++;
      else if (outcome.reason === "quiet_hours") {
        held = true;
        break;
      } else skipped++;
    }
    const remaining = audience.length - done.size - sent - skipped;
    await sb
      .from("seasonal_campaign_runs")
      .update({
        audience: audience.length,
        sent: run.sent + sent,
        skipped: run.skipped + skipped,
        ...(remaining <= 0 && !held ? { status: "done", finished_at: now.toISOString() } : {}),
      })
      .eq("id", run.id);
    result.sent += sent;
    result.skipped += skipped;
  }
  return result;
}

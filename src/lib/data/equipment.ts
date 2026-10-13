import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import { buildLoadout, type LoadoutCheck, type LoadoutSession } from "@/lib/loadout";
import { dateKeyIn, minutesIn } from "@/lib/time-zone";
import { kitsForServices, loadoutOverdue, minutesOfTime, serviceIdsFrom } from "@/lib/equipment/kits";
import {
  allDue,
  shouldRaiseAlert,
  type Asset,
  type DueStatus,
  type Meter,
  type ServiceInterval,
  type ServiceRecord,
} from "@/lib/equipment/maintenance";
import { raiseClaimedException } from "@/lib/data/purchasing";
import { leadsForJob, orgLeads, tellLeads } from "@/lib/data/supply-people";

/**
 * Equipment upkeep, kits and the load-out watch, against the database.
 *
 * The rules are in src/lib/equipment/. Each automation here has its own
 * switch and start time in equipment_settings, and none acts on anything
 * that was already the case when it was switched on.
 */

export interface EquipmentSettings {
  maintenanceAlertsEnabled: boolean;
  maintenanceStartedAt: string | null;
  loadoutWatchEnabled: boolean;
  loadoutStartedAt: string | null;
  loadoutGraceMinutes: number;
  kitDeriveEnabled: boolean;
  kitDeriveStartedAt: string | null;
  dueSoonDays: number;
  dueSoonHours: number;
  dueSoonMiles: number;
  ready: boolean;
}

export const DEFAULT_EQUIPMENT: EquipmentSettings = {
  maintenanceAlertsEnabled: false,
  maintenanceStartedAt: null,
  loadoutWatchEnabled: false,
  loadoutStartedAt: null,
  loadoutGraceMinutes: 60,
  kitDeriveEnabled: false,
  kitDeriveStartedAt: null,
  dueSoonDays: 14,
  dueSoonHours: 10,
  dueSoonMiles: 500,
  ready: true,
};

export async function loadEquipmentSettings(sb: SupabaseClient, organizationId: string): Promise<EquipmentSettings> {
  const { data, error } = await sb.from("equipment_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) return { ...DEFAULT_EQUIPMENT, ready: false };
  if (!data) return DEFAULT_EQUIPMENT;
  return {
    maintenanceAlertsEnabled: Boolean(data.maintenance_alerts_enabled),
    maintenanceStartedAt: data.maintenance_started_at ?? null,
    loadoutWatchEnabled: Boolean(data.loadout_watch_enabled),
    loadoutStartedAt: data.loadout_started_at ?? null,
    loadoutGraceMinutes: Number(data.loadout_grace_minutes ?? 60),
    kitDeriveEnabled: Boolean(data.kit_derive_enabled),
    kitDeriveStartedAt: data.kit_derive_started_at ?? null,
    dueSoonDays: Number(data.due_soon_days ?? 14),
    dueSoonHours: Number(data.due_soon_hours ?? 10),
    dueSoonMiles: Number(data.due_soon_miles ?? 500),
    ready: true,
  };
}

/* -------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------- */

export interface AssetRow extends Asset {
  year: number | null;
  make: string | null;
  model: string | null;
}

export async function loadAssets(sb: SupabaseClient, organizationId: string): Promise<AssetRow[]> {
  const { data } = await sb
    .from("fleet_assets")
    .select("id, name, kind, equipment_type, meter, mileage, engine_hours, year, make, model")
    .eq("organization_id", organizationId)
    .is("retired_on", null)
    .order("name");
  return ((data ?? []) as Record<string, unknown>[]).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    kind: a.kind as string,
    equipmentType: (a.equipment_type as string | null) ?? null,
    meter: ((a.meter as string | null) ?? defaultMeter(a.kind as string)) as Meter,
    mileage: a.mileage == null ? null : Number(a.mileage),
    engineHours: a.engine_hours == null ? null : Number(a.engine_hours),
    year: (a.year as number | null) ?? null,
    make: (a.make as string | null) ?? null,
    model: (a.model as string | null) ?? null,
  }));
}

/** Before the migration's `meter` column exists: trucks have odometers, mowers hour meters. */
function defaultMeter(kind: string): Meter {
  return kind === "truck" ? "miles" : kind === "mower" ? "hours" : "none";
}

async function loadIntervals(sb: SupabaseClient, organizationId: string): Promise<ServiceInterval[]> {
  const { data } = await sb.from("equipment_service_intervals").select("*").eq("organization_id", organizationId);
  return ((data ?? []) as Record<string, unknown>[]).map((i) => ({
    id: i.id as string,
    assetId: (i.asset_id as string | null) ?? null,
    equipmentType: (i.equipment_type as string | null) ?? null,
    task: i.task as string,
    everyHours: i.every_hours == null ? null : Number(i.every_hours),
    everyMiles: i.every_miles == null ? null : Number(i.every_miles),
    everyDays: i.every_days == null ? null : Number(i.every_days),
    isDefault: Boolean(i.is_default),
    active: i.active !== false,
  }));
}

async function loadRecords(sb: SupabaseClient, organizationId: string): Promise<(ServiceRecord & { createdAt: string })[]> {
  const { data } = await sb
    .from("equipment_service_records")
    .select("asset_id, task, done_on, at_hours, at_miles, created_at")
    .eq("organization_id", organizationId)
    .order("done_on", { ascending: false })
    .limit(2000);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    assetId: r.asset_id as string,
    task: r.task as string,
    doneOn: r.done_on as string,
    atHours: r.at_hours == null ? null : Number(r.at_hours),
    atMiles: r.at_miles == null ? null : Number(r.at_miles),
    createdAt: r.created_at as string,
  }));
}

/** The newest log or service record per machine, for the backlog rule. */
async function lastActivity(sb: SupabaseClient, organizationId: string, records: { assetId: string; createdAt: string }[]): Promise<Map<string, string>> {
  const { data } = await sb
    .from("equipment_usage_logs")
    .select("asset_id, updated_at")
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false })
    .limit(2000);
  const out = new Map<string, string>();
  const bump = (id: string, at: string) => {
    if (!out.has(id) || out.get(id)! < at) out.set(id, at);
  };
  for (const r of (data ?? []) as { asset_id: string; updated_at: string }[]) bump(r.asset_id, r.updated_at);
  for (const r of records) bump(r.assetId, r.createdAt);
  return out;
}

/* -------------------------------------------------------------------------
 * Maintenance alerts
 * ---------------------------------------------------------------------- */

async function runMaintenance(sb: SupabaseClient, organizationId: string, settings: EquipmentSettings, today: string): Promise<{ raised: number; resolved: number }> {
  const [assets, intervals, records] = await Promise.all([loadAssets(sb, organizationId), loadIntervals(sb, organizationId), loadRecords(sb, organizationId)]);
  const statuses = allDue(assets, intervals, records, today, { days: settings.dueSoonDays, hours: settings.dueSoonHours, miles: settings.dueSoonMiles });
  const activity = await lastActivity(sb, organizationId, records);

  // Close what has been dealt with: an open alert whose key is no longer an
  // overdue key (the task was logged as done, or the interval changed).
  const overdueKeys = new Set(statuses.filter((s) => s.state === "overdue").map((s) => s.dedupeKey));
  const { data: open } = await sb.from("equipment_alerts").select("id, dedupe_key").eq("organization_id", organizationId).eq("state", "open");
  let resolved = 0;
  for (const alert of (open ?? []) as { id: string; dedupe_key: string }[]) {
    if (overdueKeys.has(alert.dedupe_key)) continue;
    await sb
      .from("equipment_alerts")
      .update({ state: "resolved", resolved_at: new Date().toISOString(), resolution: "Logged as done, or no longer due." })
      .eq("id", alert.id);
    resolved++;
  }

  let raised = 0;
  const newly: DueStatus[] = [];
  for (const status of statuses) {
    if (!shouldRaiseAlert({ status, startedAt: settings.maintenanceStartedAt, lastActivityAt: activity.get(status.assetId) ?? null })) continue;
    const { error } = await sb.from("equipment_alerts").insert({
      organization_id: organizationId,
      asset_id: status.assetId,
      task: status.task,
      summary: `${status.assetName}: ${status.task} is overdue. ${status.reason}.`,
      dedupe_key: status.dedupeKey,
    });
    if (error) continue; // already raised for this stretch
    raised++;
    newly.push(status);
  }
  if (newly.length) {
    const lines = newly.slice(0, 5).map((s) => `${s.assetName}: ${s.task}`).join("; ");
    await tellLeads(
      await orgLeads(sb, organizationId),
      `Equipment service overdue: ${lines}${newly.length > 5 ? ` and ${newly.length - 5} more` : ""}. Log it when it's done.`,
      `equipment-overdue:${today}`
    );
  }
  return { raised, resolved };
}

/* -------------------------------------------------------------------------
 * Kits from the services sold
 * ---------------------------------------------------------------------- */

/**
 * Fills in the kits on new visits that nobody filled in.
 *
 * Only visits created after the switch, only ones with no kits yet, and each
 * visit once: kits_derived_at is set whether or not anything was found, so a
 * person who clears the list afterwards is not overruled by the next run.
 */
export async function deriveSessionKits(sb: SupabaseClient, organizationId: string, since: string): Promise<number> {
  const { data: sessions } = await sb
    .from("job_work_sessions")
    .select("id, job_id, kits, tool_ids")
    .eq("organization_id", organizationId)
    .is("kits_derived_at", null)
    .neq("status", "cancelled")
    .gte("created_at", since)
    .limit(200);
  const rows = (sessions ?? []) as { id: string; job_id: string; kits: number[] | null; tool_ids: string[] | null }[];
  if (rows.length === 0) return 0;

  const [{ data: serviceTools }, { data: tools }] = await Promise.all([
    sb.from("service_tools").select("service_type_id, tool_id"),
    sb.from("tools").select("id, kits, active").eq("organization_id", organizationId),
  ]);
  const toolList = ((tools ?? []) as { id: string; kits: number[] | null; active: boolean }[]).filter((t) => t.active).map((t) => ({ id: t.id, kits: t.kits ?? [] }));

  let filled = 0;
  const byJob = new Map<string, string[]>();
  for (const s of rows) {
    if (!byJob.has(s.job_id)) {
      const [{ data: design }, { data: requested }] = await Promise.all([
        sb.from("canvas_designs").select("zones").eq("job_id", s.job_id).maybeSingle(),
        sb.from("job_requested_services").select("service_type_id").eq("job_id", s.job_id),
      ]);
      byJob.set(s.job_id, serviceIdsFrom((design as { zones: unknown } | null)?.zones, (requested ?? []) as { service_type_id: string }[]));
    }
    const patch: Record<string, unknown> = { kits_derived_at: new Date().toISOString() };
    if ((s.kits ?? []).length === 0) {
      const { kits, looseToolIds } = kitsForServices(byJob.get(s.job_id)!, (serviceTools ?? []) as { service_type_id: string; tool_id: string }[], toolList);
      if (kits.length) patch.kits = kits;
      if ((s.tool_ids ?? []).length === 0 && looseToolIds.length) patch.tool_ids = looseToolIds;
      if (kits.length || looseToolIds.length) filled++;
    }
    const { error } = await sb.from("job_work_sessions").update(patch).eq("id", s.id).is("kits_derived_at", null);
    if (error) log.error("equipment.kit_derive_failed", undefined, { sessionId: s.id, message: error.message });
  }
  return filled;
}

/* -------------------------------------------------------------------------
 * The load-out watch
 * ---------------------------------------------------------------------- */

/**
 * After the trucks should have gone: anybody on today's work who has things
 * to load, hasn't ticked them all, and hasn't left the shop becomes an
 * exception on their first job, for its lead. Once per person per day.
 */
async function watchLoadouts(sb: SupabaseClient, organizationId: string, settings: EquipmentSettings, now: Date): Promise<number> {
  const day = dateKeyIn(now);
  if (!settings.loadoutStartedAt || settings.loadoutStartedAt.slice(0, 10) > day) return 0;
  const { data: org } = await sb.from("organizations").select("shop_arrival_time").eq("id", organizationId).maybeSingle();
  const shopMinutes = minutesOfTime((org as { shop_arrival_time?: string | null } | null)?.shop_arrival_time);
  const nowMinutes = minutesIn(now);
  if (nowMinutes < shopMinutes + settings.loadoutGraceMinutes) return 0;

  const { data: sessionRows } = await sb
    .from("job_work_sessions")
    .select("id, job_id, kits, tool_ids, materials, meet_on_site, stop_order, jobs(status, name)")
    .eq("organization_id", organizationId)
    .lte("starts_on", day)
    .gte("ends_on", day)
    .not("status", "in", "(cancelled,done)")
    .is("subcontractor_id", null);
  type Row = { id: string; job_id: string; kits: number[] | null; tool_ids: string[] | null; materials: string[] | null; meet_on_site: boolean | null; stop_order: number | null; jobs: { status: string; name: string } | null };
  const sessions = ((sessionRows ?? []) as unknown as Row[]).filter((s) => s.jobs && s.jobs.status !== "cancelled" && s.jobs.status !== "completed");
  if (sessions.length === 0) return 0;

  const jobIds = [...new Set(sessions.map((s) => s.job_id))];
  const [{ data: crew }, { data: checks }, { data: events }] = await Promise.all([
    sb.from("job_crew").select("job_id, profile_id").in("job_id", jobIds),
    sb.from("loadout_checks").select("profile_id, item_kind, item_key").eq("organization_id", organizationId).eq("day", day),
    sb.from("crew_day_events").select("profile_id, kind").eq("organization_id", organizationId).eq("day", day),
  ]);
  const left = new Set(((events ?? []) as { profile_id: string; kind: string }[]).filter((e) => e.kind === "left_shop").map((e) => e.profile_id));
  const checksBy = new Map<string, LoadoutCheck[]>();
  for (const c of (checks ?? []) as { profile_id: string; item_kind: string; item_key: string }[]) {
    checksBy.set(c.profile_id, [...(checksBy.get(c.profile_id) ?? []), { kind: c.item_kind as LoadoutCheck["kind"], key: c.item_key }]);
  }
  const people = new Map<string, Row[]>();
  for (const c of (crew ?? []) as { job_id: string; profile_id: string }[]) {
    people.set(c.profile_id, [...(people.get(c.profile_id) ?? []), ...sessions.filter((s) => s.job_id === c.job_id)]);
  }

  let raised = 0;
  for (const [profileId, mine] of people) {
    const loadSessions: LoadoutSession[] = mine.map((s) => ({
      sessionId: s.id,
      jobId: s.job_id,
      customerName: s.jobs?.name ?? "a job",
      address: "",
      kits: s.kits ?? [],
      toolIds: s.tool_ids ?? [],
      materials: s.materials ?? [],
    }));
    const loadout = buildLoadout(loadSessions, [], [], checksBy.get(profileId) ?? []);
    const overdue = loadoutOverdue({
      nowMinutes,
      shopMinutes,
      graceMinutes: settings.loadoutGraceMinutes,
      itemCount: loadout.total,
      complete: loadout.complete,
      leftShop: left.has(profileId),
      throughShop: mine.some((s) => !s.meet_on_site),
    });
    if (!overdue) continue;

    const first = [...mine].sort((a, b) => (a.stop_order ?? 99) - (b.stop_order ?? 99))[0];
    const { data: person } = await sb.from("profiles").select("full_name, email").eq("id", profileId).maybeSingle();
    const who = (person as { full_name: string | null; email: string | null } | null)?.full_name || "A crew member";
    const missing = loadout.items.filter((i) => !i.checked).map((i) => i.label);
    const id = await raiseClaimedException(sb, {
      organizationId,
      dedupeKey: `loadout:${profileId}:${day}`,
      jobId: first.job_id,
      workSessionId: first.id,
      kind: "equipment_unavailable",
      summary: `${who} hasn't checked the load-out and hasn't left the shop`,
      detail: `${loadout.done} of ${loadout.total} ticked. Not ticked: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? "…" : ""}.`,
    });
    if (!id) continue;
    raised++;
    await tellLeads(
      (await leadsForJob(sb, organizationId, first.job_id)).filter((p) => p !== profileId),
      `${who} hasn't checked the load-out for ${first.jobs?.name ?? "today"} (${loadout.done} of ${loadout.total} ticked) and hasn't left the shop.`,
      `loadout:${profileId}:${day}`
    );
  }
  return raised;
}

/* -------------------------------------------------------------------------
 * The run
 * ---------------------------------------------------------------------- */

export interface EquipmentRun {
  organizationId: string;
  alertsRaised: number;
  alertsResolved: number;
  kitsFilled: number;
  loadoutExceptions: number;
  skipped?: string;
}

export async function runEquipment(sb: SupabaseClient, organizationId: string, now = new Date()): Promise<EquipmentRun> {
  const settings = await loadEquipmentSettings(sb, organizationId);
  const run: EquipmentRun = { organizationId, alertsRaised: 0, alertsResolved: 0, kitsFilled: 0, loadoutExceptions: 0 };
  if (!settings.ready) return { ...run, skipped: "equipment tables not created yet" };
  const today = dateKeyIn(now);
  if (settings.maintenanceAlertsEnabled && settings.maintenanceStartedAt) {
    const m = await runMaintenance(sb, organizationId, settings, today);
    run.alertsRaised = m.raised;
    run.alertsResolved = m.resolved;
  }
  if (settings.kitDeriveEnabled && settings.kitDeriveStartedAt) {
    run.kitsFilled = await deriveSessionKits(sb, organizationId, settings.kitDeriveStartedAt);
  }
  if (settings.loadoutWatchEnabled) {
    run.loadoutExceptions = await watchLoadouts(sb, organizationId, settings, now);
  }
  return run;
}

/* -------------------------------------------------------------------------
 * For the panel
 * ---------------------------------------------------------------------- */

export interface EquipmentPanelData {
  settings: EquipmentSettings;
  assets: AssetRow[];
  due: DueStatus[];
  intervals: (ServiceInterval & { assetName: string | null })[];
  alerts: { id: string; assetId: string; task: string; summary: string; raisedAt: string }[];
  loadoutExceptions: { id: string; jobId: string; summary: string; detail: string | null; reportedAt: string }[];
  /** Today's crew: how many people have something to load, and how many have ticked it all. */
  loadoutToday: { people: number; complete: number };
  /** Visits in the next two weeks with no kits on them. */
  visitsWithoutKits: number;
  usageLoggedToday: number;
}

export async function loadEquipmentPanel(sb: SupabaseClient, organizationId: string, now = new Date()): Promise<EquipmentPanelData> {
  const settings = await loadEquipmentSettings(sb, organizationId);
  const today = dateKeyIn(now);
  const [assets, intervals, records] = await Promise.all([loadAssets(sb, organizationId), loadIntervals(sb, organizationId), settings.ready ? loadRecords(sb, organizationId) : Promise.resolve([])]);
  const due = allDue(assets, intervals, records, today, { days: settings.dueSoonDays, hours: settings.dueSoonHours, miles: settings.dueSoonMiles });
  const assetName = new Map(assets.map((a) => [a.id, a.name]));

  const twoWeeks = new Date(now.getTime() + 14 * 86400000).toISOString().slice(0, 10);
  const [{ data: alerts }, { data: exceptions }, { data: upcoming }, { data: logs }, { data: todays }, { data: checks }] = await Promise.all([
    settings.ready
      ? sb.from("equipment_alerts").select("id, asset_id, task, summary, raised_at").eq("organization_id", organizationId).eq("state", "open").order("raised_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    sb
      .from("job_exceptions")
      .select("id, job_id, summary, detail, reported_at")
      .eq("organization_id", organizationId)
      .eq("kind", "equipment_unavailable")
      .is("reported_by", null)
      .in("state", ["reported", "acknowledged"])
      .order("reported_at", { ascending: false }),
    sb
      .from("job_work_sessions")
      .select("id, kits, tool_ids")
      .eq("organization_id", organizationId)
      .gte("starts_on", today)
      .lte("starts_on", twoWeeks)
      .not("status", "in", "(cancelled,done)"),
    settings.ready ? sb.from("equipment_usage_logs").select("id").eq("organization_id", organizationId).eq("day", today) : Promise.resolve({ data: [] }),
    sb
      .from("job_work_sessions")
      .select("job_id, kits, tool_ids, materials")
      .eq("organization_id", organizationId)
      .lte("starts_on", today)
      .gte("ends_on", today)
      .not("status", "in", "(cancelled,done)"),
    sb.from("loadout_checks").select("profile_id").eq("organization_id", organizationId).eq("day", today),
  ]);

  // A rough count for the strip: people on today's loaded visits, against
  // people with any tick today. The crew screen has the exact list.
  const loadedJobs = ((todays ?? []) as { job_id: string; kits: number[] | null; tool_ids: string[] | null; materials: string[] | null }[])
    .filter((s) => (s.kits ?? []).length + (s.tool_ids ?? []).length + (s.materials ?? []).length > 0)
    .map((s) => s.job_id);
  let people = 0;
  let complete = 0;
  if (loadedJobs.length) {
    const { data: crew } = await sb.from("job_crew").select("profile_id").in("job_id", [...new Set(loadedJobs)]);
    const crewIds = new Set(((crew ?? []) as { profile_id: string }[]).map((c) => c.profile_id));
    const ticked = new Set(((checks ?? []) as { profile_id: string }[]).map((c) => c.profile_id));
    people = crewIds.size;
    complete = [...crewIds].filter((id) => ticked.has(id)).length;
  }

  return {
    settings,
    assets,
    due,
    intervals: intervals.map((i) => ({ ...i, assetName: i.assetId ? (assetName.get(i.assetId) ?? null) : null })),
    alerts: ((alerts ?? []) as { id: string; asset_id: string; task: string; summary: string; raised_at: string }[]).map((a) => ({
      id: a.id,
      assetId: a.asset_id,
      task: a.task,
      summary: a.summary,
      raisedAt: a.raised_at,
    })),
    loadoutExceptions: ((exceptions ?? []) as { id: string; job_id: string; summary: string; detail: string | null; reported_at: string }[]).map((e) => ({
      id: e.id,
      jobId: e.job_id,
      summary: e.summary,
      detail: e.detail,
      reportedAt: e.reported_at,
    })),
    loadoutToday: { people, complete },
    visitsWithoutKits: ((upcoming ?? []) as { kits: number[] | null; tool_ids: string[] | null }[]).filter((s) => (s.kits ?? []).length === 0 && (s.tool_ids ?? []).length === 0).length,
    usageLoggedToday: ((logs ?? []) as unknown[]).length,
  };
}

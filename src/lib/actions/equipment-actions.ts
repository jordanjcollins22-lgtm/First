"use server";

import { revalidatePath } from "next/cache";

import { getRealProfile } from "@/lib/data/team";
import { hasRole, isOwnerLevel, roleKeysOf } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateKeyIn } from "@/lib/time-zone";
import { applyUsage, readingWarning, EQUIPMENT_TYPES, type Meter } from "@/lib/equipment/maintenance";
import { untyped } from "@/lib/data/purchasing";

/**
 * Equipment upkeep from the panel, and the crew's end-of-day log.
 *
 * Settings are the owner's. Intervals, service records and machine details
 * are the owner's or a project lead's. The end-of-day log is anybody on the
 * team: the person who drove the truck is the one who can read its odometer.
 */

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

const PATH = "/v2/operations";

async function caller(level: "owner" | "lead" | "team") {
  const me = await getRealProfile();
  if (!me) return { error: "Not signed in." } as const;
  const owner = isOwnerLevel(me.roles);
  const allowed =
    level === "owner" ? owner : level === "lead" ? owner || hasRole(me.roles, "project-lead") : roleKeysOf(me.roles).length > 0;
  if (!allowed) {
    return {
      error: level === "owner" ? "Only the owner can change this." : level === "lead" ? "Only the owner or a project lead can do this." : "Only the team can log equipment.",
    } as const;
  }
  return { me, sb: untyped(createAdminClient()) } as const;
}

function done(message?: string): ActionResult {
  revalidatePath(PATH);
  return { ok: true, message };
}

/* -------------------------------------------------------------------------
 * Settings
 * ---------------------------------------------------------------------- */

export interface EquipmentSettingsPatch {
  maintenanceAlertsEnabled?: boolean;
  loadoutWatchEnabled?: boolean;
  loadoutGraceMinutes?: number;
  kitDeriveEnabled?: boolean;
  dueSoonDays?: number;
}

/** Saves the switches, stamping the first time each is turned on and never moving it. */
export async function saveEquipmentSettings(patch: EquipmentSettingsPatch): Promise<ActionResult> {
  const c = await caller("owner");
  if ("error" in c) return { ok: false, error: c.error! };
  const { me, sb } = c;
  const { data: current, error: readError } = await sb.from("equipment_settings").select("*").eq("organization_id", me.organization_id).maybeSingle();
  if (readError) return { ok: false, error: "The equipment tables aren't set up yet (migration 0360)." };
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { organization_id: me.organization_id, updated_at: now, updated_by: me.id };
  const stamp = (flag: keyof EquipmentSettingsPatch, column: string, startedColumn: string) => {
    if (patch[flag] === undefined) return;
    row[column] = Boolean(patch[flag]);
    if (patch[flag] && !current?.[startedColumn]) row[startedColumn] = now;
  };
  stamp("maintenanceAlertsEnabled", "maintenance_alerts_enabled", "maintenance_started_at");
  stamp("loadoutWatchEnabled", "loadout_watch_enabled", "loadout_started_at");
  stamp("kitDeriveEnabled", "kit_derive_enabled", "kit_derive_started_at");
  if (patch.loadoutGraceMinutes !== undefined) {
    const m = Math.round(Number(patch.loadoutGraceMinutes));
    if (!Number.isFinite(m) || m < 0 || m > 600) return { ok: false, error: "Grace must be between 0 and 600 minutes." };
    row.loadout_grace_minutes = m;
  }
  if (patch.dueSoonDays !== undefined) {
    const d = Math.round(Number(patch.dueSoonDays));
    if (!Number.isFinite(d) || d < 0 || d > 120) return { ok: false, error: "Due-soon days must be between 0 and 120." };
    row.due_soon_days = d;
  }
  const { error } = await sb.from("equipment_settings").upsert(row);
  if (error) return { ok: false, error: "Couldn't save the settings." };
  return done("Saved.");
}

/* -------------------------------------------------------------------------
 * Machines, intervals and service records
 * ---------------------------------------------------------------------- */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

async function ownAsset(sb: ReturnType<typeof untyped>, organizationId: string, assetId: string) {
  const { data } = await sb.from("fleet_assets").select("id, name, kind, meter, mileage, engine_hours").eq("id", assetId).eq("organization_id", organizationId).maybeSingle();
  return data as { id: string; name: string; kind: string; meter: Meter | null; mileage: number | null; engine_hours: number | null } | null;
}

/** What a machine is and what it reads. A reading can be set here by hand, up or down, to fix a mistake. */
export async function saveAssetMeter(input: { assetId: string; equipmentType: string | null; meter: Meter; mileage?: number | null; engineHours?: number | null }): Promise<ActionResult> {
  const c = await caller("lead");
  if ("error" in c) return { ok: false, error: c.error! };
  const asset = await ownAsset(c.sb, c.me.organization_id, input.assetId);
  if (!asset) return { ok: false, error: "That machine isn't one of ours." };
  if (input.equipmentType && !(EQUIPMENT_TYPES as readonly string[]).includes(input.equipmentType)) return { ok: false, error: "Unknown equipment type." };
  if (!["miles", "hours", "none"].includes(input.meter)) return { ok: false, error: "Unknown meter." };
  const patch: Record<string, unknown> = { equipment_type: input.equipmentType || null, meter: input.meter, updated_at: new Date().toISOString() };
  if (input.mileage !== undefined) patch.mileage = input.mileage == null ? null : Math.round(input.mileage);
  if (input.engineHours !== undefined) patch.engine_hours = input.engineHours;
  const { error } = await c.sb.from("fleet_assets").update(patch).eq("id", asset.id);
  if (error) return { ok: false, error: "Couldn't save that machine." };
  return done("Saved.");
}

/**
 * Adds or changes an interval. Editing a seeded default makes it yours: the
 * "default, adjust" label comes off, because somebody has now adjusted it.
 */
export async function saveServiceInterval(input: {
  id?: string | null;
  assetId?: string | null;
  equipmentType?: string | null;
  task: string;
  everyHours: number | null;
  everyMiles: number | null;
  everyDays: number | null;
  active?: boolean;
}): Promise<ActionResult> {
  const c = await caller("lead");
  if ("error" in c) return { ok: false, error: c.error! };
  const task = input.task.trim();
  if (!task) return { ok: false, error: "Say what the task is." };
  const everyHours = num(input.everyHours) || null;
  const everyMiles = num(input.everyMiles) ? Math.round(num(input.everyMiles)!) : null;
  const everyDays = num(input.everyDays) ? Math.round(num(input.everyDays)!) : null;
  if (!everyHours && !everyMiles && !everyDays) return { ok: false, error: "Give it hours, miles or days." };
  if (input.assetId && !(await ownAsset(c.sb, c.me.organization_id, input.assetId))) return { ok: false, error: "That machine isn't one of ours." };
  if (!input.assetId && (!input.equipmentType || !(EQUIPMENT_TYPES as readonly string[]).includes(input.equipmentType))) {
    return { ok: false, error: "Pick a machine or a type of machine." };
  }
  const row = {
    organization_id: c.me.organization_id,
    asset_id: input.assetId || null,
    equipment_type: input.assetId ? null : input.equipmentType,
    task,
    every_hours: everyHours,
    every_miles: everyMiles,
    every_days: everyDays,
    is_default: false,
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };
  const { error } = input.id
    ? await c.sb.from("equipment_service_intervals").update(row).eq("id", input.id).eq("organization_id", c.me.organization_id)
    : await c.sb.from("equipment_service_intervals").insert(row);
  if (error) return { ok: false, error: error.code === "23505" ? "That type already has a task with that name." : "Couldn't save the interval." };
  return done("Interval saved.");
}

/** A service was done. The meter moves forward if the reading is ahead of it. Any open alert closes on the next run. */
export async function recordService(input: {
  assetId: string;
  task: string;
  doneOn: string;
  atHours?: number | null;
  atMiles?: number | null;
  costDollars?: number | null;
  note?: string | null;
}): Promise<ActionResult> {
  const c = await caller("lead");
  if ("error" in c) return { ok: false, error: c.error! };
  const asset = await ownAsset(c.sb, c.me.organization_id, input.assetId);
  if (!asset) return { ok: false, error: "That machine isn't one of ours." };
  const task = input.task.trim();
  if (!task) return { ok: false, error: "Say what was done." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.doneOn) || input.doneOn > dateKeyIn(new Date())) return { ok: false, error: "Pick the day it was done, not in the future." };
  // With no reading given, the machine's current reading is the one it was done at.
  const atHours = num(input.atHours) ?? (asset.engine_hours == null ? null : Number(asset.engine_hours));
  const atMiles = num(input.atMiles) != null ? Math.round(num(input.atMiles)!) : asset.mileage;
  const cost = num(input.costDollars);
  const { error } = await c.sb.from("equipment_service_records").insert({
    organization_id: c.me.organization_id,
    asset_id: asset.id,
    task,
    done_on: input.doneOn,
    at_hours: atHours,
    at_miles: atMiles,
    cost_cents: cost == null ? null : Math.round(cost * 100),
    note: input.note?.trim() || null,
    recorded_by: c.me.id,
  });
  if (error) return { ok: false, error: "Couldn't record that." };
  const meterPatch: Record<string, unknown> = {};
  if (atHours != null && (asset.engine_hours == null || atHours > Number(asset.engine_hours))) meterPatch.engine_hours = atHours;
  if (atMiles != null && (asset.mileage == null || atMiles > asset.mileage)) meterPatch.mileage = atMiles;
  if (Object.keys(meterPatch).length) await c.sb.from("fleet_assets").update(meterPatch).eq("id", asset.id);
  // Close the alert now rather than waiting for the run: it was for this task.
  await c.sb
    .from("equipment_alerts")
    .update({ state: "resolved", resolved_at: new Date().toISOString(), resolved_by: c.me.id, resolution: `Done ${input.doneOn}.` })
    .eq("organization_id", c.me.organization_id)
    .eq("asset_id", asset.id)
    .eq("state", "open")
    .ilike("task", task);
  return done("Recorded.");
}

export async function dismissEquipmentAlert(id: string, reason: string): Promise<ActionResult> {
  const c = await caller("lead");
  if ("error" in c) return { ok: false, error: c.error! };
  const why = reason.trim();
  if (!why) return { ok: false, error: "Say why it's being dismissed." };
  await c.sb
    .from("equipment_alerts")
    .update({ state: "dismissed", resolved_at: new Date().toISOString(), resolved_by: c.me.id, resolution: why })
    .eq("id", id)
    .eq("organization_id", c.me.organization_id);
  return done("Dismissed.");
}

/* -------------------------------------------------------------------------
 * The crew's end-of-day log
 * ---------------------------------------------------------------------- */

export interface UsageEntry {
  assetId: string;
  /** Odometer or hour meter, for machines with one. */
  reading?: number | null;
  /** Hours it ran today, for machines without. */
  usedHours?: number | null;
}

/**
 * Logs today's hours and miles. One row per person, machine and day, so
 * sending the form again corrects the figures rather than doubling them.
 */
export async function logEquipmentUsage(entries: UsageEntry[]): Promise<ActionResult> {
  const c = await caller("team");
  if ("error" in c) return { ok: false, error: c.error! };
  const day = dateKeyIn(new Date());
  const warnings: string[] = [];
  let saved = 0;
  for (const entry of entries.slice(0, 30)) {
    const reading = num(entry.reading);
    const usedHours = num(entry.usedHours);
    if (reading == null && usedHours == null) continue;
    if (usedHours != null && usedHours > 24) {
      warnings.push("Hours run can't be more than 24 in a day.");
      continue;
    }
    const asset = await ownAsset(c.sb, c.me.organization_id, entry.assetId);
    if (!asset) continue;
    const shaped = {
      meter: (asset.meter ?? "none") as Meter,
      mileage: asset.mileage,
      engineHours: asset.engine_hours == null ? null : Number(asset.engine_hours),
      name: asset.name,
    };
    const { data: previous } = await c.sb
      .from("equipment_usage_logs")
      .select("reading, used_hours")
      .eq("asset_id", asset.id)
      .eq("profile_id", c.me.id)
      .eq("day", day)
      .maybeSingle();
    const prev = previous as { reading: number | null; used_hours: number | null } | null;
    const { error } = await c.sb.from("equipment_usage_logs").upsert(
      {
        organization_id: c.me.organization_id,
        asset_id: asset.id,
        profile_id: c.me.id,
        day,
        reading: shaped.meter === "none" ? null : reading,
        used_hours: shaped.meter === "none" ? usedHours : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "asset_id,profile_id,day" }
    );
    if (error) continue;
    const warning = readingWarning(shaped, shaped.meter === "none" ? null : reading);
    if (warning) warnings.push(warning);
    const next = applyUsage(
      shaped,
      prev ? { reading: prev.reading == null ? null : Number(prev.reading), usedHours: prev.used_hours == null ? null : Number(prev.used_hours) } : null,
      { reading: shaped.meter === "none" ? null : reading, usedHours: shaped.meter === "none" ? usedHours : null }
    );
    await c.sb.from("fleet_assets").update({ mileage: next.mileage, engine_hours: next.engineHours }).eq("id", asset.id);
    saved++;
  }
  revalidatePath(PATH);
  revalidatePath("/today");
  revalidatePath("/my-day");
  if (saved === 0) return warnings.length ? { ok: false, error: warnings.join(" ") } : { ok: false, error: "Nothing to log. Enter a reading or hours." };
  return { ok: true, message: `Logged ${saved} machine${saved === 1 ? "" : "s"}.${warnings.length ? ` ${warnings.join(" ")}` : ""}` };
}

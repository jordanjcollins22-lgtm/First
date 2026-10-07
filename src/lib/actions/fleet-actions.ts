"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { ASSET_KINDS, CONDITIONS } from "@/lib/fleet";

/**
 * Keeping the trucks, the trailers and the plan to replace them.
 *
 * The field worth being careful about is the breakdown count. It is the only
 * input to the risk model that is a fact rather than an estimate, so it has to
 * be one tap to record on the day it happens -- a breakdown remembered three
 * weeks later is a breakdown nobody enters.
 */

const FLEET_PATH = "/admin/fleet";

export type FleetResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? { value?: undefined } : { value: T }))
  | { ok: false; error: string };

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export async function saveAsset(input: {
  id: string | null;
  name: string;
  kind: string;
  year: string;
  make: string;
  model: string;
  mileage: string;
  condition: string;
  monthlyCost: string;
  resaleValue: string;
  notes: string;
}): Promise<FleetResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const name = input.name.trim();
  if (!name) return fail("What do you call it?");
  if (!ASSET_KINDS.some((k) => k.key === input.kind)) return fail("Say what sort of thing it is.");
  if (!CONDITIONS.some((c) => c.key === input.condition)) return fail("Say what condition it is in.");

  const year = numberOrNull(input.year);
  if (year !== null && (year < 1900 || year > 2100)) return fail("That isn't a year.");

  const row = {
    organization_id: profile.organization_id,
    name,
    kind: input.kind,
    year: year === null ? null : Math.round(year),
    make: input.make.trim() || null,
    model: input.model.trim() || null,
    mileage: roundOrNull(numberOrNull(input.mileage)),
    condition: input.condition,
    monthly_cost: numberOrNull(input.monthlyCost),
    resale_value: numberOrNull(input.resaleValue),
    notes: input.notes.trim().slice(0, 500) || null,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase.from("fleet_assets").update(row).eq("id", input.id);
    if (error) return fail(error.message);
    revalidatePath(FLEET_PATH);
    return { ok: true, value: { id: input.id } };
  }

  const { data, error } = await supabase.from("fleet_assets").insert(row).select("id").single();
  if (error || !data) return fail(error?.message ?? "Couldn't save that.");
  revalidatePath(FLEET_PATH);
  return { ok: true, value: { id: data.id } };
}

/**
 * It broke down again.
 *
 * One tap, on the day, because that is the only way this number stays true.
 * It moves the odds on every screen that reads them, which is the point: the
 * case for buying sooner should get stronger by itself every time the old
 * truck proves it.
 */
export async function recordBreakdown(input: {
  id: string;
  /** Undo, for the tap that was meant for the other row. */
  undo?: boolean;
}): Promise<FleetResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { data: asset } = await supabase
    .from("fleet_assets")
    .select("breakdowns_12mo")
    .eq("id", input.id)
    .maybeSingle();
  if (!asset) return fail("That isn't one of ours.");

  const next = Math.max(0, (asset.breakdowns_12mo ?? 0) + (input.undo ? -1 : 1));
  const { error } = await supabase
    .from("fleet_assets")
    .update({
      breakdowns_12mo: next,
      ...(input.undo ? {} : { last_breakdown_on: new Date().toISOString().slice(0, 10) }),
    })
    .eq("id", input.id);
  if (error) return fail(error.message);

  revalidatePath(FLEET_PATH);
  return { ok: true };
}

export async function retireAsset(input: { id: string; retired: boolean }): Promise<FleetResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("fleet_assets")
    .update({ retired_on: input.retired ? new Date().toISOString().slice(0, 10) : null })
    .eq("id", input.id);
  if (error) return fail(error.message);

  revalidatePath(FLEET_PATH);
  return { ok: true };
}

export async function saveTarget(input: {
  id: string | null;
  name: string;
  kind: string;
  cost: string;
  deposit: string;
  monthly: string;
  replacesAssetId: string;
  priority: string;
  url: string;
  notes: string;
}): Promise<FleetResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const name = input.name.trim();
  if (!name) return fail("What are you buying?");

  const cost = numberOrNull(input.cost);
  const deposit = numberOrNull(input.deposit);
  if (cost !== null && deposit !== null && deposit > cost) {
    return fail("The deposit can't be more than the price.");
  }

  const row = {
    organization_id: profile.organization_id,
    name,
    kind: input.kind,
    cost_cents: toCents(cost),
    deposit_cents: toCents(deposit),
    monthly_cents: toCents(numberOrNull(input.monthly)),
    replaces_asset_id: input.replacesAssetId || null,
    priority: Math.round(numberOrNull(input.priority) ?? 100),
    url: input.url.trim() || null,
    notes: input.notes.trim().slice(0, 1000) || null,
    updated_at: new Date().toISOString(),
  };

  const supabase = await createClient();
  if (input.id) {
    const { error } = await supabase.from("fleet_targets").update(row).eq("id", input.id);
    if (error) return fail(error.message);
    revalidatePath(FLEET_PATH);
    return { ok: true, value: { id: input.id } };
  }

  const { data, error } = await supabase.from("fleet_targets").insert(row).select("id").single();
  if (error || !data) return fail(error?.message ?? "Couldn't save that.");
  revalidatePath(FLEET_PATH);
  return { ok: true, value: { id: data.id } };
}

/** Bought. Retires whatever it replaced, in the same breath, because a truck
 * that has been replaced and is still counted is a truck still adding risk. */
export async function markBought(input: { id: string }): Promise<FleetResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const today = new Date().toISOString().slice(0, 10);
  const supabase = await createClient();

  const { data: target } = await supabase
    .from("fleet_targets")
    .select("replaces_asset_id")
    .eq("id", input.id)
    .maybeSingle();

  const { error } = await supabase.from("fleet_targets").update({ bought_on: today }).eq("id", input.id);
  if (error) return fail(error.message);

  if (target?.replaces_asset_id) {
    await supabase.from("fleet_assets").update({ retired_on: today }).eq("id", target.replaces_asset_id);
  }

  revalidatePath(FLEET_PATH);
  return { ok: true };
}

export async function removeTarget(input: { id: string }): Promise<FleetResult> {
  const profile = await getCurrentProfile();
  if (!profile) return fail("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase.from("fleet_targets").delete().eq("id", input.id);
  if (error) return fail(error.message);

  revalidatePath(FLEET_PATH);
  return { ok: true };
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function toCents(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100);
}

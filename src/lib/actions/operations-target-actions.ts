"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { describeDbError } from "@/lib/setup-errors";
import { log } from "@/lib/log";
import type { Json } from "@/lib/supabase/database.types";
import type { LatLng } from "@/types/domain";
import type { OperationsTarget, OperationsTargetStatus } from "@/lib/data/operations-targets";

export type TargetResult<T = undefined> = { ok: true; value: T } | { ok: false; message: string };

const OFFICE_ROLES = new Set(["admin", "owner", "overhead", "office", "account manager"]);

async function officeProfile() {
  const profile = await getCurrentProfile();
  if (!profile) return null;
  return profile.roles.some((r) => OFFICE_ROLES.has(r)) ? profile : null;
}

function cleanPoints(points: unknown): LatLng[] | null {
  if (!Array.isArray(points) || points.length < 3 || points.length > 400) return null;
  const out: LatLng[] = [];
  for (const p of points) {
    const lat = Number((p as LatLng)?.lat);
    const lng = Number((p as LatLng)?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    out.push({ lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 });
  }
  return out;
}

/** Rebuild the court ranking from the county's houses. Office only. */
export async function rebuildCourtTargets(): Promise<TargetResult<{ courts: number }>> {
  try {
    const profile = await officeProfile();
    if (!profile) return { ok: false, message: "Only the office can rebuild the courts." };
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("court_targets_build", { org: profile.organization_id });
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath("/attractors");
    return { ok: true, value: { courts: Number(data ?? 0) } };
  } catch (e) {
    log.error("court_targets_build", { error: String(e) });
    return { ok: false, message: "The courts could not be rebuilt." };
  }
}

/** Save an outline the office drew, or a court it picked, as a target. */
export async function saveOperationsTarget(input: {
  name: string;
  points: LatLng[];
  courtId?: string | null;
  notes?: string | null;
}): Promise<TargetResult<OperationsTarget>> {
  try {
    const profile = await officeProfile();
    if (!profile) return { ok: false, message: "Only the office can set targets." };
    const name = input.name.trim().slice(0, 120);
    if (!name) return { ok: false, message: "Give the target a name." };
    const points = cleanPoints(input.points);
    if (!points) return { ok: false, message: "Draw at least three points." };

    const supabase = await createClient();
    const ring = points.map((p) => [p.lng, p.lat]) as unknown as Json;
    const { data: count } = await supabase.rpc("houses_in_ring_count", { org: profile.organization_id, ring });

    const { data, error } = await supabase
      .from("operations_targets")
      .insert({
        organization_id: profile.organization_id,
        name,
        outline: points as unknown as Json,
        court_id: input.courtId ?? null,
        notes: input.notes?.trim() || null,
        house_count: typeof count === "number" ? count : null,
        created_by: profile.id,
      })
      .select("id, name, outline, court_id, status, notes, house_count, created_at")
      .single();
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath("/attractors");
    return {
      ok: true,
      value: {
        id: data.id,
        name: data.name,
        outline: data.outline as unknown as LatLng[],
        courtId: data.court_id,
        status: data.status as OperationsTargetStatus,
        notes: data.notes,
        houseCount: data.house_count,
        createdAt: data.created_at,
      },
    };
  } catch (e) {
    log.error("operations_target_save", { error: String(e) });
    return { ok: false, message: "The target could not be saved." };
  }
}

/**
 * Keep the shape somebody dragged a court's outline into.
 *
 * Stored beside the build's own ring, never over it, so a rebuild refreshes
 * the counts and leaves the drawn shape alone.
 */
export async function saveCourtOutline(courtId: string, points: LatLng[]): Promise<TargetResult<{ houseCount: number | null }>> {
  try {
    const profile = await officeProfile();
    if (!profile) return { ok: false, message: "Only the office can reshape a court." };
    const clean = cleanPoints(points);
    if (!clean) return { ok: false, message: "An outline needs at least three corners." };
    const ring = clean.map((p) => [p.lng, p.lat]);
    ring.push(ring[0]);
    const admin = createAdminClient();
    const { error } = await admin
      .from("court_targets")
      .update({ custom_outline: ring as unknown as Json, custom_outline_at: new Date().toISOString() })
      .eq("id", courtId)
      .eq("organization_id", profile.organization_id);
    if (error) return { ok: false, message: describeDbError(error) };
    // The ring changed, so the homes inside it did.
    const { data: count } = await admin.rpc("court_inside_count", { the_court: courtId });
    return { ok: true, value: { houseCount: typeof count === "number" ? count : null } };
  } catch (e) {
    log.error("court_outline_save", { error: String(e) });
    return { ok: false, message: "The court's outline could not be saved." };
  }
}

/** Count the homes inside a court's ring again, as it is drawn now. */
export async function refreshCourtHouseCount(courtId: string): Promise<TargetResult<{ houseCount: number | null }>> {
  try {
    const profile = await officeProfile();
    if (!profile) return { ok: false, message: "Only the office can recount." };
    const admin = createAdminClient();
    const { data: court } = await admin.from("court_targets").select("id").eq("id", courtId).eq("organization_id", profile.organization_id).maybeSingle();
    if (!court) return { ok: false, message: "That court is not on file." };
    const { data: count, error } = await admin.rpc("court_inside_count", { the_court: courtId });
    if (error) return { ok: false, message: describeDbError(error) };
    return { ok: true, value: { houseCount: typeof count === "number" ? count : null } };
  } catch (e) {
    log.error("court_count_refresh", { error: String(e) });
    return { ok: false, message: "The homes could not be counted." };
  }
}

/** Count the homes inside a saved target's ring again. */
export async function refreshOperationsTargetHouseCount(id: string): Promise<TargetResult<{ houseCount: number | null }>> {
  try {
    const profile = await officeProfile();
    if (!profile) return { ok: false, message: "Only the office can recount." };
    const supabase = await createClient();
    const { data: target } = await supabase.from("operations_targets").select("id, outline").eq("id", id).maybeSingle();
    if (!target) return { ok: false, message: "That target is not on file." };
    const points = cleanPoints(target.outline);
    if (!points) return { ok: false, message: "The target has no outline to count." };
    const ring = points.map((p) => [p.lng, p.lat]) as unknown as Json;
    const { data: count, error } = await supabase.rpc("houses_in_ring_count", { org: profile.organization_id, ring });
    if (error) return { ok: false, message: describeDbError(error) };
    const houseCount = typeof count === "number" ? count : null;
    await supabase.from("operations_targets").update({ house_count: houseCount, updated_at: new Date().toISOString() }).eq("id", id);
    revalidatePath("/attractors");
    return { ok: true, value: { houseCount } };
  } catch (e) {
    log.error("target_count_refresh", { error: String(e) });
    return { ok: false, message: "The homes could not be counted." };
  }
}

/** A saved target dragged into a new shape: keep it, and recount its homes. */
export async function saveOperationsTargetOutline(id: string, points: LatLng[]): Promise<TargetResult<{ houseCount: number | null }>> {
  try {
    const profile = await officeProfile();
    if (!profile) return { ok: false, message: "Only the office can reshape a target." };
    const clean = cleanPoints(points);
    if (!clean) return { ok: false, message: "An outline needs at least three corners." };
    const supabase = await createClient();
    const ring = clean.map((p) => [p.lng, p.lat]) as unknown as Json;
    const { data: count } = await supabase.rpc("houses_in_ring_count", { org: profile.organization_id, ring });
    const houseCount = typeof count === "number" ? count : null;
    const { error } = await supabase
      .from("operations_targets")
      .update({ outline: clean as unknown as Json, house_count: houseCount, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath("/attractors");
    return { ok: true, value: { houseCount } };
  } catch (e) {
    log.error("operations_target_outline", { error: String(e) });
    return { ok: false, message: "The target's outline could not be saved." };
  }
}

export async function setOperationsTargetStatus(id: string, status: OperationsTargetStatus): Promise<TargetResult> {
  try {
    const profile = await officeProfile();
    if (!profile) return { ok: false, message: "Only the office can change targets." };
    if (!["planned", "active", "done"].includes(status)) return { ok: false, message: "Bad status." };
    const supabase = await createClient();
    const { error } = await supabase.from("operations_targets").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath("/attractors");
    return { ok: true, value: undefined };
  } catch (e) {
    log.error("operations_target_status", { error: String(e) });
    return { ok: false, message: "The target could not be changed." };
  }
}

export async function deleteOperationsTarget(id: string): Promise<TargetResult> {
  try {
    const profile = await officeProfile();
    if (!profile) return { ok: false, message: "Only the office can remove targets." };
    const supabase = await createClient();
    const { error } = await supabase.from("operations_targets").delete().eq("id", id);
    if (error) return { ok: false, message: describeDbError(error) };
    revalidatePath("/attractors");
    return { ok: true, value: undefined };
  } catch (e) {
    log.error("operations_target_delete", { error: String(e) });
    return { ok: false, message: "The target could not be removed." };
  }
}

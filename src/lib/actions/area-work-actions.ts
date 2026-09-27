"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { getCanvasDesignForJob } from "@/lib/data/canvas-design";
import { loadAreaBoard } from "@/lib/data/area-board";
import { canTick, stepsFor } from "@/lib/area-work";
import type { WorkZone } from "@/components/canvas/types";

export type AreaResult = { ok: true; message?: string } | { ok: false; message: string };

function refresh(jobId: string) {
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/jobs/${jobId}/work-order`);
}

/** The board as it stands in the database, not as a phone last saw it. */
async function freshBoard(jobId: string) {
  const supabase = await createClient();
  const [design, catalog, { data: photos }, { data: job }] = await Promise.all([
    getCanvasDesignForJob(jobId),
    getCanvasCatalog(),
    supabase.from("job_photos").select("zone_id, kind").eq("job_id", jobId),
    supabase.from("jobs").select("id, property:properties!inner(customers!inner(organization_id))").eq("id", jobId).maybeSingle(),
  ]);
  if (!job) return null;
  const zones = design ? ((design.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service) : [];
  const board = await loadAreaBoard(jobId, { zones, catalog, photos: (photos ?? []) as { zone_id: string | null; kind: string }[] });
  const organizationId = (job as unknown as { property: { customers: { organization_id: string } } }).property.customers.organization_id;
  return { board, zones, organizationId, photos: (photos ?? []) as { zone_id: string | null; kind: string }[] };
}

/**
 * Start in an area, or join whoever is in it. Leaves the area you were in.
 * Takes the kits the area needs, unless they are in use somewhere else, in
 * which case it says where.
 */
export async function startArea(jobId: string, zoneId: string): Promise<AreaResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const fresh = await freshBoard(jobId);
  if (!fresh) return { ok: false, message: "Couldn't find that job." };
  const state = fresh.board.states.find((s) => s.zoneId === zoneId);
  if (!state) return { ok: false, message: "That area isn't on the site map." };
  if (state.status === "done") return { ok: false, message: "That area is finished." };
  if (state.status === "waiting") return { ok: false, message: state.waitingReason ?? "Its kit is in use in another area." };
  // Prepped and waiting on the rest: the next thing to do is somewhere else.
  if (state.prepped && !fresh.board.allPrepped) return { ok: false, message: "This area is prepped. Prep the next one: the install starts once every area is prepped." };
  if (fresh.board.myZoneId === zoneId) return { ok: true };

  const supabase = await createClient();
  const now = new Date().toISOString();
  await supabase.from("job_area_work").update({ left_at: now }).eq("job_id", jobId).eq("profile_id", profile.id).is("left_at", null);
  const { error } = await supabase.from("job_area_work").insert({
    organization_id: fresh.organizationId,
    job_id: jobId,
    zone_id: zoneId,
    profile_id: profile.id,
    kits: state.status === "working" ? state.kits : state.wouldTake,
  });
  if (error) return { ok: false, message: "Couldn't start there. Try again." };
  refresh(jobId);
  return { ok: true };
}

/** Step out of the area you are in, and give back its kits if you were the last one there. */
export async function leaveArea(jobId: string): Promise<AreaResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const supabase = await createClient();
  await supabase.from("job_area_work").update({ left_at: new Date().toISOString() }).eq("job_id", jobId).eq("profile_id", profile.id).is("left_at", null);
  refresh(jobId);
  return { ok: true };
}

/** Tick a step, or untick it. The work waits on the prep and its during photo. */
export async function tickAreaStep(jobId: string, zoneId: string, stepKey: string, done: boolean): Promise<AreaResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const fresh = await freshBoard(jobId);
  if (!fresh) return { ok: false, message: "Couldn't find that job." };
  const zone = fresh.zones.find((z) => z.id === zoneId);
  if (!zone) return { ok: false, message: "That area isn't on the site map." };
  const list = stepsFor(zone.service!.typeId, zone.service!.values);
  const step = list.find((s) => s.key === stepKey);
  if (!step) return { ok: false, message: "That step isn't on this area." };

  const supabase = await createClient();
  if (!done) {
    await supabase.from("job_area_steps").delete().eq("job_id", jobId).eq("zone_id", zoneId).eq("step_key", stepKey);
    refresh(jobId);
    return { ok: true };
  }

  const ticked = new Set(fresh.board.steps[zoneId]?.filter((s) => s.doneBy).map((s) => s.step.key) ?? []);
  const hasDuring = fresh.photos.some((p) => p.zone_id === zoneId && p.kind === "during");
  const verdict = canTick(step, list, ticked, hasDuring, fresh.board.allPrepped);
  if (!verdict.ok) return { ok: false, message: verdict.reason };

  const { error } = await supabase.from("job_area_steps").upsert(
    { organization_id: fresh.organizationId, job_id: jobId, zone_id: zoneId, step_key: stepKey, done_by: profile.id, done_at: new Date().toISOString() },
    { onConflict: "job_id,zone_id,step_key" }
  );
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  refresh(jobId);
  return { ok: true };
}

/**
 * A photo is in, and either way the area is finished for now. The prep
 * photo: it is prepped, and everybody moves on to prep the next area, since
 * no work starts until every area is prepped. The after photo: it is done.
 * Either way everybody in it is freed and its kits go back.
 */
export async function areaPhotoTaken(jobId: string, zoneId: string): Promise<AreaResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  await supabase.from("job_area_work").update({ left_at: now }).eq("job_id", jobId).eq("zone_id", zoneId).is("left_at", null);
  refresh(jobId);
  return { ok: true };
}

"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { EDDM_BUILD_KIND, describeBuild, zipsForBuild, type EddmBuildScope } from "@/lib/eddm-build";
import { kickStep, newTickToken, selfBaseUrl } from "@/lib/gis-import-run";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Starting and watching the countywide USPS-routes-to-door-hangers build.
 *
 * The build itself runs on the server in the background (see eddm-build);
 * these only start it, pause it, and say how far it has got. Nothing here
 * throws to the browser: a thrown server error reaches a screen as React
 * error #441 with its message stripped, so every action returns either a
 * value or the message.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface EddmBuildStatus {
  jobId: string;
  status: string;
  summary: string;
  zips: number;
  zipsDone: number;
  updatedAt: string;
}

const PAGE = "/attractors";

async function guard<T>(name: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[eddm-build] ${name} failed:`, err);
    return { ok: false, error: messageOf(err) };
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as { message?: string; details?: string; hint?: string };
    return [e.message, e.details, e.hint].filter(Boolean).join(" ") || "Unknown error.";
  }
  return String(err);
}

async function requireAccess() {
  const { allowed, profile } = await checkTabAccess("project-data");
  if (!allowed || !profile) throw new Error("You don't have access to Project Data.");
  if (!isSupabaseAdminConfigured) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  return profile;
}

/**
 * Builds door-hanger waves from USPS routes for every ZIP in the county.
 *
 * The first build replaces the hand-drawn waves: they were test shapes, and
 * the USPS routes are the real ones. Later builds only refresh routes and
 * re-assign houses; waves already made are kept, so nothing anyone has done
 * on them is lost.
 */
export async function startEddmBuild(): Promise<ActionResult<EddmBuildStatus>> {
  return guard("startEddmBuild", async () => {
    const profile = await requireAccess();
    if (!env.cronSecret) throw new Error("CRON_SECRET must be set on the server for the build to run in the background.");
    const admin = createAdminClient();
    const org = profile.organization_id;

    const { data: active } = await admin
      .from("gis_import_jobs")
      .select("id")
      .eq("organization_id", org)
      .eq("kind", EDDM_BUILD_KIND)
      .eq("status", "running")
      .limit(1);
    if (active && active.length > 0) throw new Error("A build is already running. Let it finish first.");

    const { data: counts, error: countsError } = await admin.rpc("houses_zip_counts", { org });
    if (countsError) throw countsError;
    const zips = zipsForBuild((counts ?? []) as { zip: string; n: number }[]);
    if (zips.length === 0) throw new Error("No houses with a ZIP yet. Run the county import first.");

    // Hand-drawn waves are replaced by the first build only, and only the
    // one-off polygons: a wave of any other type was made on purpose.
    const { data: existingHanger } = await admin
      .from("attractor_waves")
      .select("id")
      .eq("organization_id", org)
      .eq("type_id", "door_hangers")
      .limit(1);
    let replaceWaves: string[] = [];
    if (!existingHanger || existingHanger.length === 0) {
      const { data: drawn } = await admin
        .from("attractor_waves")
        .select("id")
        .eq("organization_id", org)
        .eq("type_id", "one_off")
        .eq("geometry_type", "polygon");
      replaceWaves = (drawn ?? []).map((w) => w.id);
    }

    const scope: EddmBuildScope = { zips, replaceWaves };
    const { data: job, error } = await admin
      .from("gis_import_jobs")
      .insert({
        organization_id: org,
        kind: EDDM_BUILD_KIND,
        status: "running",
        scope: scope as unknown as Json,
        service_url: "https://gis.usps.com/arcgis/rest/services/EDDM",
        total_expected: zips.length,
        checkpoint: { offset: 0, attempts: 0, replaced: false, zips: {} } as unknown as Json,
        tick_token: newTickToken(),
        started_by: profile.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    await kick(job.id, org);
    revalidatePath(PAGE);
    return {
      jobId: job.id,
      status: job.status,
      summary: describeBuild(job),
      zips: zips.length,
      zipsDone: 0,
      updatedAt: job.updated_at,
    };
  });
}

/** Where the build has got to, for a screen that asks every few seconds. */
export async function eddmBuildStatus(): Promise<ActionResult<EddmBuildStatus | null>> {
  return guard("eddmBuildStatus", async () => {
    const profile = await requireAccess();
    const admin = createAdminClient();
    const { data: job, error } = await admin
      .from("gis_import_jobs")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("kind", EDDM_BUILD_KIND)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!job) return null;
    const scope = (job.scope ?? {}) as { zips?: string[] };
    const checkpoint = (job.checkpoint ?? {}) as { offset?: number };
    return {
      jobId: job.id,
      status: job.status,
      summary: describeBuild(job),
      zips: scope.zips?.length ?? 0,
      zipsDone: Math.min(checkpoint.offset ?? 0, scope.zips?.length ?? 0),
      updatedAt: job.updated_at,
    };
  });
}

/** Stops after the ZIP in flight. Starting again picks up where it left off. */
export async function pauseEddmBuild(jobId: string): Promise<ActionResult<null>> {
  return guard("pauseEddmBuild", async () => {
    const profile = await requireAccess();
    const admin = createAdminClient();
    const { error } = await admin
      .from("gis_import_jobs")
      .update({ status: "paused", tick_token: null, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("organization_id", profile.organization_id)
      .eq("kind", EDDM_BUILD_KIND);
    if (error) throw error;
    revalidatePath(PAGE);
    return null;
  });
}

export async function resumeEddmBuild(jobId: string): Promise<ActionResult<null>> {
  return guard("resumeEddmBuild", async () => {
    const profile = await requireAccess();
    const admin = createAdminClient();
    const { error } = await admin
      .from("gis_import_jobs")
      .update({ status: "running", tick_token: newTickToken(), lease_until: null, last_error: null, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("organization_id", profile.organization_id)
      .eq("kind", EDDM_BUILD_KIND)
      .in("status", ["paused", "failed"]);
    if (error) throw error;
    await kick(jobId, profile.organization_id);
    revalidatePath(PAGE);
    return null;
  });
}

/** Records where this deployment answers for the scheduler, then asks for the first step now. */
async function kick(jobId: string, organizationId: string) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const base = selfBaseUrl(host ? `${proto}://${host}` : "");
  if (!base) throw new Error("Could not work out this deployment's own URL.");

  const admin = createAdminClient();
  const { error } = await admin
    .from("gis_import_settings")
    .upsert({ organization_id: organizationId, base_url: base, updated_at: new Date().toISOString() });
  if (error) throw error;

  try {
    await kickStep(base, jobId);
  } catch (err) {
    const message = messageOf(err);
    console.error("[eddm-build] first step could not be kicked directly:", message);
    await admin
      .from("gis_import_jobs")
      .update({ last_error: `First step could not be started directly (${message}); waiting for the scheduler.` })
      .eq("id", jobId);
  }
}

"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { kickStep, newTickToken, selfBaseUrl } from "@/lib/gis-import-run";
import { describeRoadsImport, HARFORD_BBOX, OSM_KIND, tilesFor, type OsmScope } from "@/lib/osm-roads";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Reading the county's roads from OpenStreetMap, in the background.
 *
 * One click; the scheduler does the rest, a tile every half minute, and
 * the walks are redrawn on the roads when it is done.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface RoadsStatus {
  jobId: string;
  status: string;
  summary: string;
  updatedAt: string;
}

async function guard<T>(name: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[roads] ${name} failed:`, err);
    const e = err as { message?: string; details?: string };
    return { ok: false, error: [e?.message, e?.details].filter(Boolean).join(" ") || String(err) };
  }
}

async function requireAccess() {
  const { allowed, profile } = await checkTabAccess("project-data");
  if (!allowed || !profile) throw new Error("You don't have access to Project Data.");
  if (!isSupabaseAdminConfigured) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  return profile;
}

function statusOf(job: { id: string; status: string; fetched: number; last_error: string | null; scope: Json; checkpoint: Json; updated_at: string }): RoadsStatus {
  return { jobId: job.id, status: job.status, summary: describeRoadsImport(job), updatedAt: job.updated_at };
}

export async function startRoadsImport(): Promise<ActionResult<RoadsStatus>> {
  return guard("startRoadsImport", async () => {
    const profile = await requireAccess();
    if (!env.cronSecret) throw new Error("CRON_SECRET must be set on the server for the import to run in the background.");
    const admin = createAdminClient();
    const org = profile.organization_id;
    const { data: active } = await admin.from("gis_import_jobs").select("id").eq("organization_id", org).eq("kind", OSM_KIND).eq("status", "running").limit(1);
    if (active && active.length > 0) throw new Error("The roads are already being read. Let it finish first.");

    const scope: OsmScope = { tiles: tilesFor(HARFORD_BBOX, 4, 4) };
    const { data: job, error } = await admin
      .from("gis_import_jobs")
      .insert({
        organization_id: org,
        kind: OSM_KIND,
        status: "running",
        scope: scope as unknown as Json,
        service_url: "https://overpass-api.de/api/interpreter",
        layer_url: "https://overpass-api.de/api/interpreter",
        checkpoint: { offset: 0, attempts: 0 } as unknown as Json,
        tick_token: newTickToken(),
        started_by: profile.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
    const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
    const base = selfBaseUrl(host ? `${proto}://${host}` : "");
    if (base) {
      await admin.from("gis_import_settings").upsert({ organization_id: org, base_url: base, updated_at: new Date().toISOString() });
      try {
        await kickStep(base, job.id);
      } catch (err) {
        console.error("[roads] first step could not be kicked directly:", err);
      }
    }
    revalidatePath("/attractors");
    return statusOf(job);
  });
}

export async function roadsStatus(): Promise<ActionResult<RoadsStatus | null>> {
  return guard("roadsStatus", async () => {
    const profile = await requireAccess();
    const admin = createAdminClient();
    const { data: job, error } = await admin
      .from("gis_import_jobs")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("kind", OSM_KIND)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return job ? statusOf(job) : null;
  });
}

"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { cleanEndpoint } from "@/lib/arcgis";
import { discoverLayer, kickStep, newTickToken, selfBaseUrl } from "@/lib/gis-import-run";
import { DEFAULT_SDAT_URL, discoverSdatFields, sdatMappingIsUsable, sdatWhere } from "@/lib/sdat";
import { SDAT_KIND, describeSdatImport } from "@/lib/sdat-import";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Starting and watching the State assessment-roll import.
 *
 * The import itself runs in the background (see sdat-import). Starting it
 * is the one moment a person is involved: the layer is read for its fields
 * right then, and if it does not describe parcels with addresses the start
 * says so, with what was found, instead of a job that fails a minute later.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface SdatStatus {
  jobId: string;
  status: string;
  summary: string;
  fetched: number;
  totalExpected: number | null;
  updatedAt: string;
}

const PAGE = "/attractors";

async function guard<T>(name: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[sdat] ${name} failed:`, err);
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

function statusOf(job: { id: string; status: string; fetched: number; matched: number; skipped: number; total_expected: number | null; last_error: string | null; updated_at: string }): SdatStatus {
  return {
    jobId: job.id,
    status: job.status,
    summary: describeSdatImport(job),
    fetched: job.fetched,
    totalExpected: job.total_expected,
    updatedAt: job.updated_at,
  };
}

/** Reads the layer, records what it has, and sets the import going. */
export async function startSdatImport(rawUrl?: string): Promise<ActionResult<SdatStatus>> {
  return guard("startSdatImport", async () => {
    const profile = await requireAccess();
    if (!env.cronSecret) throw new Error("CRON_SECRET must be set on the server for the import to run in the background.");
    const admin = createAdminClient();
    const org = profile.organization_id;

    const { data: active } = await admin.from("gis_import_jobs").select("id").eq("organization_id", org).eq("kind", SDAT_KIND).eq("status", "running").limit(1);
    if (active && active.length > 0) throw new Error("The roll is already being read. Let it finish first.");

    let endpoint: string;
    try {
      endpoint = cleanEndpoint((rawUrl ?? "").trim() || DEFAULT_SDAT_URL);
    } catch {
      throw new Error("That is not a URL an ArcGIS server would answer.");
    }
    const discovery = await discoverLayer(endpoint, "server-action");
    if (!discovery.probe.ok) {
      throw new Error(`The State's server did not answer at ${endpoint}: ${discovery.probe.message ?? discovery.probe.kind}`);
    }
    if (!discovery.layerUrl) {
      const found = discovery.description.kind === "catalog"
        ? [...discovery.description.services, ...discovery.description.folders]
        : discovery.description.kind === "service"
          ? discovery.description.layers.map((l) => `${l.id}: ${l.name}`)
          : [];
      throw new Error(`${endpoint} is a ${discovery.description.kind}, not a layer. Found: ${found.slice(0, 12).join(", ") || "nothing"}. Give the parcel layer's URL.`);
    }
    const fields = discovery.description.fields;
    const mapping = discoverSdatFields(fields.map((f) => f.name));
    if (!sdatMappingIsUsable(mapping)) {
      throw new Error(`The layer at ${discovery.layerUrl} has no premise address field. Its fields: ${fields.map((f) => f.name).slice(0, 40).join(", ")}`);
    }
    const zipField = fields.find((f) => f.name === mapping.zip);
    const zipIsNumber = /Integer|Double|Single/i.test(zipField?.type ?? "");

    const { data: counts, error: countsError } = await admin.rpc("houses_zip_counts", { org });
    if (countsError) throw countsError;
    const zips = ((counts ?? []) as { zip: string; n: number }[]).filter((c) => c.n >= 20).map((c) => c.zip);

    const { data: job, error } = await admin
      .from("gis_import_jobs")
      .insert({
        organization_id: org,
        kind: SDAT_KIND,
        status: "running",
        scope: { zips, zipIsNumber, where: sdatWhere(mapping, zips, zipIsNumber) } as unknown as Json,
        service_url: endpoint,
        layer_url: discovery.layerUrl,
        layer_name: discovery.layerName,
        max_record_count: discovery.description.maxRecordCount,
        discovered_fields: fields as unknown as Json,
        field_mapping: mapping as unknown as Json,
        diagnostics: discovery.probes.map((p) => ({ ...p })) as unknown as Json,
        checkpoint: { offset: 0, attempts: 0 } as unknown as Json,
        tick_token: newTickToken(),
        started_by: profile.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    await kick(job.id, org);
    revalidatePath(PAGE);
    return statusOf(job);
  });
}

export async function sdatStatus(): Promise<ActionResult<SdatStatus | null>> {
  return guard("sdatStatus", async () => {
    const profile = await requireAccess();
    const admin = createAdminClient();
    const { data: job, error } = await admin
      .from("gis_import_jobs")
      .select("*")
      .eq("organization_id", profile.organization_id)
      .eq("kind", SDAT_KIND)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return job ? statusOf(job) : null;
  });
}

export async function pauseSdatImport(jobId: string): Promise<ActionResult<null>> {
  return guard("pauseSdatImport", async () => {
    const profile = await requireAccess();
    const admin = createAdminClient();
    const { error } = await admin
      .from("gis_import_jobs")
      .update({ status: "paused", tick_token: null, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("organization_id", profile.organization_id)
      .eq("kind", SDAT_KIND);
    if (error) throw error;
    revalidatePath(PAGE);
    return null;
  });
}

export async function resumeSdatImport(jobId: string): Promise<ActionResult<null>> {
  return guard("resumeSdatImport", async () => {
    const profile = await requireAccess();
    const admin = createAdminClient();
    const { error } = await admin
      .from("gis_import_jobs")
      .update({ status: "running", tick_token: newTickToken(), lease_until: null, last_error: null, updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("organization_id", profile.organization_id)
      .eq("kind", SDAT_KIND)
      .in("status", ["paused", "failed"]);
    if (error) throw error;
    await kick(jobId, profile.organization_id);
    revalidatePath(PAGE);
    return null;
  });
}

async function kick(jobId: string, organizationId: string) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const base = selfBaseUrl(host ? `${proto}://${host}` : "");
  if (!base) throw new Error("Could not work out this deployment's own URL.");
  const admin = createAdminClient();
  const { error } = await admin.from("gis_import_settings").upsert({ organization_id: organizationId, base_url: base, updated_at: new Date().toISOString() });
  if (error) throw error;
  try {
    await kickStep(base, jobId);
  } catch (err) {
    console.error("[sdat] first step could not be kicked directly:", messageOf(err));
    await admin.from("gis_import_jobs").update({ last_error: `First step could not be started directly (${messageOf(err)}); waiting for the scheduler.` }).eq("id", jobId);
  }
}

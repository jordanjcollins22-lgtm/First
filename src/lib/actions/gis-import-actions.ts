"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { env, isSupabaseAdminConfigured } from "@/lib/env";
import { checkTabAccess } from "@/lib/data/access";
import { discoverLayer, kickStep, selfBaseUrl, totals, whereFor } from "@/lib/gis-import-run";
import { cleanEndpoint } from "@/lib/arcgis";
import { normalizeAddress } from "@/lib/address-normalize";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Starting, stopping and checking the county import.
 *
 * Every one of these runs as a server function on the deployed app, which is
 * the only place the county's server can be reached from. The connection test
 * is deliberately the whole of stage one: one metadata request, its status
 * and its fields written down, and nothing imported until that has worked.
 *
 * Nothing here throws to the browser. In production Next.js replaces a thrown
 * server error with a generic message and a digest (React error #441 on the
 * client), so an action that threw "A five-digit ZIP is needed" would show
 * the person a link to a React error page instead. Every action returns
 * either a value or the message, and logs the full error on the server.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PAGE = "/admin/gis-import";

/** Runs an action, turning any throw into a returned message and a server log line. */
async function guard<T>(name: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    const message = messageOf(err);
    console.error(`[gis-import] ${name} failed:`, err);
    return { ok: false, error: message };
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    // Supabase errors are plain objects with message, details, hint, code.
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    return [e.message, e.details, e.hint, e.code ? `(${e.code})` : null].filter(Boolean).join(" ") || "Unknown error.";
  }
  return String(err);
}

async function requireAccess() {
  const { allowed, profile } = await checkTabAccess("gis-import");
  if (!allowed || !profile) throw new Error("You don't have access to the county import.");
  if (!isSupabaseAdminConfigured) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  return profile;
}

function endpointFrom(input: string): string {
  const raw = input.trim();
  if (!raw) throw new Error("A service URL is needed.");
  try {
    const cleaned = cleanEndpoint(raw);
    if (!cleaned.startsWith("https://")) throw new Error();
    return cleaned;
  } catch {
    throw new Error("That is not a URL the county's server would answer.");
  }
}

/**
 * Stage one: the smallest possible request, from the server, recorded whole.
 *
 * Nothing is imported. The job row that comes out of this carries the HTTP
 * status, the body, the error code if the request never got an answer, where
 * it ran from, and -- when it worked -- every field the layer has and which
 * of them the import would read.
 */
export async function testGisConnection(serviceUrl: string): Promise<ActionResult<{ jobId: string; ok: boolean }>> {
  return guard("testGisConnection", async () => {
    const profile = await requireAccess();
    const endpoint = endpointFrom(serviceUrl);
    const admin = createAdminClient();

    const { data: job, error } = await admin
      .from("gis_import_jobs")
      .insert({
        organization_id: profile.organization_id,
        kind: "connection_test",
        status: "running",
        service_url: endpoint,
        started_by: profile.id,
      })
      .select("id")
      .single();
    if (error) throw error;

    const discovery = await discoverLayer(endpoint, "server-action");
    const ok = Boolean(discovery.layerUrl && discovery.mapping?.address);

    let lastError: string | null = null;
    if (!discovery.probe.ok) {
      lastError = `${discovery.probe.kind}: ${discovery.probe.message ?? "no answer"}${
        discovery.probe.errorCode ? ` (${discovery.probe.errorCode})` : ""
      }`;
    } else if (discovery.description.error) {
      lastError = `The server answered 200 with an error: ${discovery.description.error}`;
    } else if (discovery.description.kind === "catalog") {
      lastError = "This is the catalog. Pick one of the services listed below and test it.";
    } else if (discovery.description.kind === "service" && !discovery.layerUrl) {
      lastError = "This service has no layer named for addresses or parcels. Pick a layer below and test its URL.";
    } else if (!discovery.mapping?.address) {
      lastError = "The layer has no field we recognise as an address, so nothing could be imported from it.";
    }

    const { error: updateError } = await admin
      .from("gis_import_jobs")
      .update({
        status: ok ? "done" : "failed",
        layer_url: discovery.layerUrl,
        layer_name: discovery.layerName,
        max_record_count: discovery.description.maxRecordCount,
        discovered_fields: discovery.description.fields as unknown as Json,
        field_mapping: (discovery.mapping ?? null) as unknown as Json,
        layers_found: {
          kind: discovery.description.kind,
          services: discovery.description.services,
          folders: discovery.description.folders,
          layers: discovery.description.layers,
          geometryType: discovery.description.geometryType,
          supportsPagination: discovery.description.supportsPagination,
        } as unknown as Json,
        diagnostics: discovery.probes.map((p) => ({ ...p })) as unknown as Json,
        last_error: lastError,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    if (updateError) throw updateError;

    revalidatePath(PAGE);
    return { jobId: job.id, ok };
  });
}

export interface StartImportInput {
  scope: "zip" | "county";
  zip?: string;
}

/**
 * Stages two and five: a bounded ZIP run, or the whole county.
 *
 * The layer comes from the last connection test that found one -- never from
 * the URL box, which after a reload holds the default catalog again while the
 * import button is still lit by the earlier test. That mismatch was the
 * production failure "The connection test has to find an address layer".
 * Discovery still runs once more on that layer, so the mapping the run uses
 * is read from the layer as it is now, not as it was when the test ran.
 */
export async function startGisImport(input: StartImportInput): Promise<ActionResult<{ jobId: string; where: string }>> {
  return guard("startGisImport", async () => {
    const profile = await requireAccess();
    if (!env.cronSecret) {
      throw new Error("CRON_SECRET must be set on the server for the import to run in the background.");
    }
    const zip = input.scope === "zip" ? (input.zip ?? "").replace(/\D/g, "").slice(0, 5) : null;
    if (input.scope === "zip" && (!zip || zip.length !== 5)) throw new Error("A five-digit ZIP is needed.");

    const admin = createAdminClient();

    const { data: active } = await admin
      .from("gis_import_jobs")
      .select("id")
      .eq("organization_id", profile.organization_id)
      .in("kind", ["zip", "county"])
      .eq("status", "running")
      .limit(1);
    if (active && active.length > 0) throw new Error("An import is already running. Pause it or let it finish first.");

    const { data: lastTest, error: testError } = await admin
      .from("gis_import_jobs")
      .select("layer_url, service_url")
      .eq("organization_id", profile.organization_id)
      .eq("kind", "connection_test")
      .eq("status", "done")
      .not("layer_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (testError) throw testError;
    if (!lastTest?.layer_url) {
      throw new Error("Run a connection test that finds the address layer first. The import uses the layer that test recorded.");
    }
    const endpoint = endpointFrom(lastTest.layer_url);

    const discovery = await discoverLayer(endpoint, "server-action");
    if (!discovery.layerUrl || !discovery.mapping?.address) {
      throw new Error(
        discovery.probe.ok
          ? `${endpoint} no longer describes a layer with an address field. Run the connection test again.`
          : `The county did not answer at ${endpoint}: ${discovery.probe.message ?? discovery.probe.kind}`
      );
    }

    const before = await totals(admin, profile.organization_id);

    const { data: job, error } = await admin
      .from("gis_import_jobs")
      .insert({
        organization_id: profile.organization_id,
        kind: input.scope,
        status: "running",
        scope: (zip ? { zip } : {}) as unknown as Json,
        service_url: lastTest.service_url,
        layer_url: discovery.layerUrl,
        layer_name: discovery.layerName,
        max_record_count: discovery.description.maxRecordCount,
        discovered_fields: discovery.description.fields as unknown as Json,
        field_mapping: discovery.mapping as unknown as Json,
        diagnostics: discovery.probes.map((p) => ({ ...p })) as unknown as Json,
        before_totals: before,
        started_by: profile.id,
      })
      .select("*")
      .single();
    if (error) throw error;

    const where = whereFor(job, discovery.mapping);

    await kick(job.id);
    revalidatePath(PAGE);
    return { jobId: job.id, where };
  });
}

async function kick(jobId: string) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "";
  const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
  const base = selfBaseUrl(host ? `${proto}://${host}` : "");
  try {
    await kickStep(base, jobId);
  } catch (err) {
    const message = messageOf(err);
    const admin = createAdminClient();
    await admin
      .from("gis_import_jobs")
      .update({ status: "failed", last_error: `Could not start the background step at ${base}: ${message}` })
      .eq("id", jobId);
    throw new Error(`Could not start the background step: ${message}`);
  }
}

/** Stops after the page in flight. The checkpoint stays where it is. */
export async function pauseGisImport(jobId: string): Promise<ActionResult<null>> {
  return guard("pauseGisImport", async () => {
    await requireAccess();
    const admin = createAdminClient();
    const { error } = await admin
      .from("gis_import_jobs")
      .update({ status: "paused", updated_at: new Date().toISOString() })
      .eq("id", jobId)
      .eq("status", "running");
    if (error) throw error;
    revalidatePath(PAGE);
    return null;
  });
}

/** Picks a paused or failed import up from its checkpoint. */
export async function resumeGisImport(jobId: string): Promise<ActionResult<null>> {
  return guard("resumeGisImport", async () => {
    await requireAccess();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("gis_import_jobs")
      .update({
        status: "running",
        lease_until: null,
        last_error: null,
        finished_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .in("status", ["paused", "failed"])
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("That import is not paused or failed.");
    await kick(jobId);
    revalidatePath(PAGE);
    return null;
  });
}

/**
 * Stage eight, and usable at any time: the integrity questions, answered now.
 *
 * Written onto the most recent job so the answer is kept next to the run it
 * describes, and returned so the screen can show it without a reload.
 */
export async function runIntegrityChecks(): Promise<ActionResult<Json>> {
  return guard("runIntegrityChecks", async () => {
    const profile = await requireAccess();
    const admin = createAdminClient();
    const report = await totals(admin, profile.organization_id);

    const { data: latest } = await admin
      .from("gis_import_jobs")
      .select("id")
      .eq("organization_id", profile.organization_id)
      .in("kind", ["zip", "county"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest) {
      await admin
        .from("gis_import_jobs")
        .update({ after_totals: report, updated_at: new Date().toISOString() })
        .eq("id", latest.id);
    }

    revalidatePath(PAGE);
    return report;
  });
}

export interface KnownHouseCheck {
  found: boolean;
  normalized: string;
  id: string | null;
  address: string | null;
  parcelId: string | null;
  gisAddress: string | null;
  gisMatchedAt: string | null;
  needsReview: boolean;
  propertyId: string | null;
  eventCount: number;
  eventKinds: string[];
  contactCount: number;
  /** How many houses share this normalized address. Must be one. */
  rowsWithThisKey: number;
}

/**
 * Stage four: does a house we know still resolve to the same row, with its
 * history still on it? Looked up by the same key the importer uses.
 */
export async function verifyKnownHouse(address: string): Promise<ActionResult<KnownHouseCheck>> {
  return guard("verifyKnownHouse", async () => {
    await requireAccess();
    const normalized = normalizeAddress(address);
    if (!normalized) throw new Error("An address is needed.");
    const supabase = await createClient();

    // house_contacts has no id column of its own -- it is a join table keyed
    // by house and customer -- so the customer id is what gets counted.
    const { data, error } = await supabase
      .from("houses")
      .select(
        "id, address, parcel_id, gis_address, gis_matched_at, needs_review, property_id, property_events(kind), house_contacts(customer_id)"
      )
      .eq("normalized_address", normalized)
      .order("created_at");
    if (error) throw error;

    const rows = (data ?? []) as unknown as {
      id: string;
      address: string;
      parcel_id: string | null;
      gis_address: string | null;
      gis_matched_at: string | null;
      needs_review: boolean;
      property_id: string | null;
      property_events: { kind: string }[] | null;
      house_contacts: { customer_id: string }[] | null;
    }[];
    const house = rows[0];

    return {
      found: Boolean(house),
      normalized,
      id: house?.id ?? null,
      address: house?.address ?? null,
      parcelId: house?.parcel_id ?? null,
      gisAddress: house?.gis_address ?? null,
      gisMatchedAt: house?.gis_matched_at ?? null,
      needsReview: house?.needs_review ?? false,
      propertyId: house?.property_id ?? null,
      eventCount: house?.property_events?.length ?? 0,
      eventKinds: [...new Set((house?.property_events ?? []).map((e) => e.kind))],
      contactCount: house?.house_contacts?.length ?? 0,
      rowsWithThisKey: rows.length,
    };
  });
}

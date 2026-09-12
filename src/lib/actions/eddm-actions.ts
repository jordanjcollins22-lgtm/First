"use server";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { env } from "@/lib/env";
import { probeEndpoint } from "@/lib/gis-probe";
import {
  DEFAULT_EDDM_ROUTES_URL,
  eddmError,
  eddmRoutesUrl,
  parseEddmRoutes,
  routesToFeatures,
  routesToStreetFeatures,
  type EddmRoute,
  type EddmRouteFeature,
  type EddmStreetFeature,
} from "@/lib/eddm";
import type { Json } from "@/lib/supabase/database.types";

/**
 * USPS carrier routes for a ZIP, from what we hold or from USPS.
 *
 * Stored routes are answered from the database. Asked to refresh, or holding
 * none, the server makes the same request USPS's own EDDM map makes and
 * writes down exactly what came back -- the request, the status, the body --
 * on a job row, so an answer of no routes can be told apart from a service
 * that has moved. Nothing here runs in a browser.
 */

export type EddmResult =
  | {
      ok: true;
      zip: string;
      routes: EddmRouteFeature[];
      /** The streets each route walks, as USPS drew them. */
      streets: EddmStreetFeature[];
      source: "stored" | "usps";
      fetchedAt: string | null;
      note: string | null;
    }
  | { ok: false; error: string };

const STALE_AFTER_DAYS = 45;

export async function loadEddmRoutes(rawZip: string, refresh = false): Promise<EddmResult> {
  const zip = rawZip.replace(/\D/g, "").slice(0, 5);
  if (zip.length !== 5) return { ok: false, error: "A five-digit ZIP is needed." };

  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, error: "Not signed in." };
    const supabase = await createClient();

    const { data: stored, error: storedError } = await supabase
      .from("eddm_routes")
      .select("id, zip, route_id, residential_count, business_count, total_count, attributes, rings, paths, fetched_at, walkability, walkability_reason, route_type, house_count, wave_id")
      .eq("organization_id", profile.organization_id)
      .eq("zip", zip)
      .order("route_id");
    if (storedError) throw storedError;

    const storedRoutes = (stored ?? []).map(toRoute);
    const newest = (stored ?? []).reduce<string | null>((max, r) => (!max || r.fetched_at > max ? r.fetched_at : max), null);
    const stale = !newest || Date.now() - new Date(newest).getTime() > STALE_AFTER_DAYS * 86_400_000;

    if (storedRoutes.length > 0 && !refresh && !stale) {
      return {
        ok: true,
        zip,
        routes: routesToFeatures(storedRoutes),
        streets: routesToStreetFeatures(storedRoutes),
        source: "stored",
        fetchedAt: newest,
        note: null,
      };
    }

    // Ask USPS, and keep the receipt.
    const url = eddmRoutesUrl(zip, env.uspsEddmRoutesUrl || DEFAULT_EDDM_ROUTES_URL);
    const { data: job } = await supabase
      .from("gis_import_jobs")
      .insert({
        organization_id: profile.organization_id,
        kind: "eddm",
        status: "running",
        scope: { zip } as unknown as Json,
        service_url: url.split("?")[0],
        started_by: profile.id,
      })
      .select("id")
      .single();

    const probe = await probeEndpoint(url, "server-action", 25_000);
    const serverError = probe.ok ? eddmError(probe.body) : null;
    const routes = probe.ok && !serverError ? parseEddmRoutes(probe.body, zip) : [];
    const failure = !probe.ok
      ? `${probe.kind}: ${probe.message ?? "no answer"}${probe.errorCode ? ` (${probe.errorCode})` : ""}`
      : serverError
        ? `USPS answered with an error: ${serverError}`
        : routes.length === 0
          ? "USPS answered, but no routes with streets or boundaries could be read from the answer. The receipt is on the County Import screen."
          : null;

    if (job) {
      await supabase
        .from("gis_import_jobs")
        .update({
          status: failure ? "failed" : "done",
          fetched: routes.length,
          processed: routes.length,
          created: routes.length,
          diagnostics: [{ ...probe, body: failure ? probe.body : null }] as unknown as Json,
          last_error: failure,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }

    if (failure) {
      if (storedRoutes.length > 0) {
        return {
          ok: true,
          zip,
          routes: routesToFeatures(storedRoutes),
          streets: routesToStreetFeatures(storedRoutes),
          source: "stored",
          fetchedAt: newest,
          note: `Showing routes saved ${newest ? new Date(newest).toLocaleDateString() : "earlier"}; USPS could not be refreshed: ${failure}`,
        };
      }
      return { ok: false, error: failure };
    }

    const now = new Date().toISOString();
    const { error: upsertError } = await supabase.from("eddm_routes").upsert(
      routes.map((r) => ({
        organization_id: profile.organization_id,
        zip: r.zip,
        route_id: r.routeId,
        residential_count: r.residential,
        business_count: r.business,
        total_count: r.total,
        attributes: r.attributes as Json,
        rings: r.rings as unknown as Json,
        paths: r.paths as unknown as Json,
        source_url: url.split("?")[0],
        fetched_at: now,
      })),
      { onConflict: "organization_id,zip,route_id" }
    );
    if (upsertError) throw upsertError;

    return {
      ok: true,
      zip,
      routes: routesToFeatures(routes),
      streets: routesToStreetFeatures(routes),
      source: "usps",
      fetchedAt: now,
      note: null,
    };
  } catch (err) {
    console.error("[eddm] loadEddmRoutes failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : "Could not load routes." };
  }
}

function toRoute(row: {
  id: string;
  zip: string;
  route_id: string;
  residential_count: number | null;
  business_count: number | null;
  total_count: number | null;
  attributes: Json;
  rings: Json;
  paths: Json | null;
  walkability?: string;
  walkability_reason?: string | null;
  route_type?: string | null;
  house_count?: number;
  wave_id?: string | null;
}): EddmRoute & { id: string } {
  return {
    id: row.id,
    zip: row.zip,
    routeId: row.route_id,
    residential: row.residential_count,
    business: row.business_count,
    total: row.total_count,
    attributes: (row.attributes ?? {}) as Record<string, unknown>,
    rings: (row.rings ?? []) as [number, number][][],
    paths: (row.paths ?? []) as [number, number][][],
    walkability: row.walkability === "walkable" || row.walkability === "hard" ? row.walkability : "unknown",
    walkabilityReason: row.walkability_reason ?? null,
    routeType: row.route_type ?? null,
    houseCount: row.house_count ?? 0,
    waveId: row.wave_id ?? null,
  };
}

import { env } from "@/lib/env";
import {
  DEFAULT_EDDM_ROUTES_URL,
  eddmError,
  eddmRoutesUrl,
  outerRing,
  parseEddmRoutes,
  type EddmRoute,
  type LngLatPair,
} from "@/lib/eddm";
import { MAIN_ROAD_CLASSES, needsRoadCheck, samplePoints, streetKm, walkVerdict, type RoadHit, type RouteFacts, type Walkability } from "@/lib/eddm-walkability";
import { acquireLease, type JobRow, type StepOutcome } from "@/lib/gis-import-run";
import { nearbyRoads } from "@/lib/mapbox-roads";
import { probeEndpoint } from "@/lib/gis-probe";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/**
 * USPS carrier routes into door-hanger waves, one ZIP per step, unattended.
 *
 * Runs the same way the county import does: the database scheduler posts to
 * the step route every thirty seconds for any build that is running and not
 * leased, and each invocation does what fits inside the function's time.
 * A step takes the next ZIP in the job's list and:
 *
 *  1. asks USPS for the ZIP's routes and writes them down with USPS's own
 *     route type (city, rural, highway contract, boxes);
 *  2. decides whether each route can be walked -- too few doors per
 *     kilometre of street is a drive, and a main road along the streets,
 *     from the map's road classes at points along them, is hard;
 *  3. cuts the streets into segments and assigns every house in the ZIP to
 *     the route whose street passes it, flagging the ones no route reaches;
 *  4. puts every house into a zone -- its route's, or the nearest housed
 *     route's when none reached it -- with a wave for every route that has
 *     houses, hard ones included;
 *  5. builds each zone: an outline that overlaps no neighbour, the doors in
 *     walking order, where to park, and whether it is a walk, a scooter or
 *     a vehicle by how far apart the doors are.
 *
 * Every write is idempotent on (organization, ZIP, route), so a step cut
 * off halfway is rerun from the same offset and the database ends up the
 * same. Nothing here runs in a browser.
 */

export const EDDM_BUILD_KIND = "eddm_build";
/** A ZIP with fewer houses than this is a stray address, not a place to build routes for. */
export const MIN_HOUSES_PER_ZIP = 20;
/**
 * How far from a route's street a house may be and still be on the route.
 * A deep lot or a long driveway puts the house a hundred metres and more
 * from the street; the door is still on the walk.
 */
export const ROUTE_REACH_M = 150;
/** How far around a sampled street point to look for a main road. */
const ROAD_LOOK_M = 50;
/** A ZIP's houses are assigned in this many parts, each inside the API's eight-second statement limit. */
const ASSIGN_PARTS = 8;
/** How many ZIPs may be begun in one invocation, by time: a ZIP is not begun after this. */
const STEP_BUDGET_MS = 15_000;
/** Deadline for USPS to answer for one ZIP. */
const USPS_TIMEOUT_MS = 25_000;
/** How many routes have their roads looked up at once. */
const ROAD_CONCURRENCY = 6;
/** A ZIP USPS will not answer for is given up on after this many tries, and the build moves on. */
const MAX_ZIP_ATTEMPTS = 2;

type Admin = ReturnType<typeof createAdminClient>;

export interface EddmBuildScope {
  zips: string[];
  /** Waves to delete once the first USPS waves exist: the hand-drawn ones this build replaces. */
  replaceWaves: string[];
}

export interface ZipResult {
  routes: number;
  walkable: number;
  hard: number;
  unknown: number;
  waves: number;
  assigned: number;
  unserved: number;
  error: string | null;
}

export interface EddmBuildCheckpoint {
  offset: number;
  attempts: number;
  replaced: boolean;
  /**
   * Where in the current ZIP the build is: `routes` still has USPS to ask
   * and the roads to check; `houses` has the routes written and has the
   * houses, waves and zones left. Two phases, because each can take twenty
   * seconds and the function has sixty.
   */
  phase: "routes" | "houses" | "zones";
  /** In the zones phase: how many of the ZIP's zones are built so far. */
  zoneIndex?: number;
  /** Zones still to rebuild after enclaves were handed over; empty when settled. */
  fixQueue?: string[];
  /** How many enclave passes this ZIP has had; three is enough. */
  passes?: number;
  zips: Record<string, ZipResult>;
}

export function scopeOf(job: Pick<JobRow, "scope">): EddmBuildScope {
  const raw = (job.scope ?? {}) as Partial<EddmBuildScope>;
  return {
    zips: Array.isArray(raw.zips) ? raw.zips.filter((z): z is string => typeof z === "string") : [],
    replaceWaves: Array.isArray(raw.replaceWaves) ? raw.replaceWaves.filter((w): w is string => typeof w === "string") : [],
  };
}

export function checkpointOf(job: Pick<JobRow, "checkpoint">): EddmBuildCheckpoint {
  const raw = (job.checkpoint ?? {}) as Partial<EddmBuildCheckpoint>;
  return {
    offset: typeof raw.offset === "number" ? raw.offset : 0,
    attempts: typeof raw.attempts === "number" ? raw.attempts : 0,
    replaced: raw.replaced === true,
    phase: raw.phase === "houses" ? "houses" : raw.phase === "zones" ? "zones" : "routes",
    zoneIndex: typeof raw.zoneIndex === "number" ? raw.zoneIndex : 0,
    fixQueue: Array.isArray(raw.fixQueue) ? raw.fixQueue.filter((z): z is string => typeof z === "string") : [],
    passes: typeof raw.passes === "number" ? raw.passes : 0,
    zips: raw.zips && typeof raw.zips === "object" ? raw.zips : {},
  };
}

/** Which ZIPs a countywide build covers, biggest first. Pure. */
export function zipsForBuild(counts: { zip: string; n: number }[], minHouses = MIN_HOUSES_PER_ZIP): string[] {
  return counts
    .filter((c) => /^\d{5}$/.test(c.zip) && c.n >= minHouses)
    .sort((a, b) => b.n - a.n)
    .map((c) => c.zip);
}

/** USPS's route type from what it sent, or from the route id's first letter. */
export function routeTypeOf(route: Pick<EddmRoute, "routeId" | "attributes">): string | null {
  for (const key of ["TYPE", "RTE_TYPE", "ROUTE_TYPE", "CRID_TYPE"]) {
    const value = route.attributes[key];
    if (typeof value === "string" && value.trim()) return value.trim().toUpperCase().slice(0, 1);
  }
  const first = route.routeId.trim().toUpperCase().slice(0, 1);
  return /^[CRHBG]$/.test(first) ? first : null;
}

/** A wave's polygon from a route's boundary: [lng, lat] rings to {lat, lng} points, unclosed. */
export function wavePointsOf(route: Pick<EddmRoute, "rings">): { lat: number; lng: number }[] | null {
  const ring = outerRing(route);
  if (!ring || ring.length < 3) return null;
  const points = ring.map(([lng, lat]) => ({ lat, lng }));
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 3 && first.lat === last.lat && first.lng === last.lng) points.pop();
  return points;
}

/** Progress in words, for the screen. Pure. */
export function describeBuild(job: Pick<JobRow, "status" | "scope" | "checkpoint" | "created" | "matched" | "review" | "skipped" | "fetched" | "last_error">): string {
  const scope = scopeOf(job);
  const checkpoint = checkpointOf(job);
  const done = Math.min(checkpoint.offset, scope.zips.length);
  const progress = `${done} of ${scope.zips.length} ZIPs`;
  const totals = `${job.created} walkable routes made waves, ${job.skipped} hard, ${job.matched.toLocaleString()} houses on a route, ${job.review.toLocaleString()} unreached`;
  if (job.status === "running") {
    const current = scope.zips[checkpoint.offset];
    return `Building: ${progress}${current ? `, on ${current}` : ""}. ${totals}.`;
  }
  if (job.status === "failed") return `Stopped at ${progress}: ${job.last_error ?? "unknown error"}. ${totals}.`;
  if (job.status === "paused") return `Paused at ${progress}. ${totals}.`;
  return `Built ${progress}. ${totals}.`;
}

/**
 * As many ZIPs as fit in one invocation.
 *
 * Each ZIP re-takes the lease, so a pause pressed between ZIPs is honoured
 * and a second runner arriving mid-loop gets nothing.
 */
export async function runEddmBuildSteps(admin: Admin, first: JobRow): Promise<StepOutcome> {
  const started = Date.now();
  let job: JobRow | null = first;
  let outcome: StepOutcome = { status: first.status, more: false, fetched: 0, message: null };
  while (job) {
    outcome = await runEddmBuildStep(admin, job);
    if (!outcome.more || outcome.status !== "running") break;
    if (Date.now() - started > STEP_BUDGET_MS) break;
    job = await acquireLease(admin, first.id);
  }
  return outcome;
}

/** One ZIP. Expects the caller to hold the lease. */
export async function runEddmBuildStep(admin: Admin, job: JobRow): Promise<StepOutcome> {
  const scope = scopeOf(job);
  const checkpoint = checkpointOf(job);
  const org = job.organization_id;
  const now = () => new Date().toISOString();

  if (checkpoint.offset >= scope.zips.length) {
    await admin
      .from("gis_import_jobs")
      .update({ status: "done", lease_until: null, finished_at: now(), updated_at: now(), steps: job.steps + 1 })
      .eq("id", job.id);
    return { status: "done", more: false, fetched: 0, message: "Every ZIP is built." };
  }

  const zip = scope.zips[checkpoint.offset];
  if (checkpoint.phase === "houses") return assignAndMaterialize(admin, job, scope, checkpoint, zip);
  if (checkpoint.phase === "zones") return buildZones(admin, job, scope, checkpoint, zip);

  const url = eddmRoutesUrl(zip, env.uspsEddmRoutesUrl || DEFAULT_EDDM_ROUTES_URL);
  const probe = await probeEndpoint(url, "background-job", USPS_TIMEOUT_MS);
  const serverError = probe.ok ? eddmError(probe.body) : null;
  const routes = probe.ok && !serverError ? parseEddmRoutes(probe.body, zip) : [];
  const failure = !probe.ok
    ? `${probe.kind}: ${probe.message ?? "no answer"}${probe.errorCode ? ` (${probe.errorCode})` : ""}`
    : serverError
      ? `USPS answered with an error: ${serverError}`
      : routes.length === 0
        ? "USPS answered with no routes that could be read."
        : null;

  const diagnostics = [...(Array.isArray(job.diagnostics) ? (job.diagnostics as Json[]) : []), { ...probe, body: null, zip } as unknown as Json].slice(-30);

  if (failure) {
    const attempts = checkpoint.attempts + 1;
    if (attempts < MAX_ZIP_ATTEMPTS) {
      // Ask again next tick; USPS drops a request now and then.
      await admin
        .from("gis_import_jobs")
        .update({
          checkpoint: { ...checkpoint, attempts } as unknown as Json,
          diagnostics,
          last_error: `ZIP ${zip}: ${failure} (will try again)`,
          lease_until: null,
          updated_at: now(),
        })
        .eq("id", job.id);
      return { status: "running", more: false, fetched: 0, message: failure };
    }
    // Given up on this ZIP; the rest of the county still gets built.
    const zips = { ...checkpoint.zips, [zip]: emptyResult(failure) };
    const next: EddmBuildCheckpoint = { offset: checkpoint.offset + 1, attempts: 0, replaced: checkpoint.replaced, phase: "routes", zips };
    const finished = next.offset >= scope.zips.length;
    await admin
      .from("gis_import_jobs")
      .update({
        checkpoint: next as unknown as Json,
        diagnostics,
        errors: job.errors + 1,
        last_error: `ZIP ${zip}: ${failure}`,
        steps: job.steps + 1,
        status: finished ? "done" : "running",
        finished_at: finished ? now() : null,
        lease_until: null,
        updated_at: now(),
      })
      .eq("id", job.id);
    return { status: finished ? "done" : "running", more: !finished, fetched: 0, message: failure };
  }

  // 1 + 2. The routes, typed and judged.
  const judged = await judgeRoutes(routes);
  const fetchedAt = now();
  const { error: upsertError } = await admin.from("eddm_routes").upsert(
    judged.map(({ route, routeType, walkability, reason, mainRoads }) => ({
      organization_id: org,
      zip: route.zip,
      route_id: route.routeId,
      residential_count: route.residential,
      business_count: route.business,
      total_count: route.total,
      attributes: route.attributes as Json,
      rings: route.rings as unknown as Json,
      paths: route.paths as unknown as Json,
      source_url: url.split("?")[0],
      fetched_at: fetchedAt,
      route_type: routeType,
      walkability,
      walkability_reason: reason,
      main_roads: mainRoads as unknown as Json,
    })),
    { onConflict: "organization_id,zip,route_id" }
  );
  if (upsertError) throw upsertError;

  // The routes are down. The houses are the next invocation's work, so a
  // slow USPS answer and a big ZIP never share one function's time.
  const judgedResult: ZipResult = {
    routes: judged.length,
    walkable: judged.filter((j) => j.walkability === "walkable").length,
    hard: judged.filter((j) => j.walkability === "hard").length,
    unknown: judged.filter((j) => j.walkability === "unknown").length,
    waves: 0,
    assigned: 0,
    unserved: 0,
    error: null,
  };
  await admin
    .from("gis_import_jobs")
    .update({
      checkpoint: { ...checkpoint, attempts: 0, phase: "houses", zips: { ...checkpoint.zips, [zip]: judgedResult } } as unknown as Json,
      diagnostics,
      fetched: job.fetched + judgedResult.routes,
      skipped: job.skipped + judgedResult.hard,
      steps: job.steps + 1,
      last_error: null,
      lease_until: null,
      updated_at: now(),
    })
    .eq("id", job.id);
  return {
    status: "running",
    more: true,
    fetched: judgedResult.routes,
    message: `${zip}: ${judgedResult.routes} routes, ${judgedResult.walkable} walkable, ${judgedResult.hard} hard. Houses next.`,
  };
}

/** The second half of a ZIP: houses onto routes, waves and zones for the walkable ones. */
async function assignAndMaterialize(
  admin: Admin,
  job: JobRow,
  scope: EddmBuildScope,
  checkpoint: EddmBuildCheckpoint,
  zip: string
): Promise<StepOutcome> {
  const org = job.organization_id;
  const now = () => new Date().toISOString();
  const judgedResult = checkpoint.zips[zip] ?? emptyResult("");

  // 3. Houses onto routes.
  const { error: segError } = await admin.rpc("eddm_rebuild_segments", { org, the_zip: zip });
  if (segError) throw segError;
  let assigned = 0;
  let unserved = 0;
  for (let part = 0; part < ASSIGN_PARTS; part++) {
    const { data: assignment, error: assignError } = await admin.rpc("eddm_assign_houses", {
      org,
      the_zip: zip,
      max_m: ROUTE_REACH_M,
      part,
      parts: ASSIGN_PARTS,
    });
    if (assignError) throw assignError;
    const counts = (assignment ?? {}) as { assigned?: number; unserved?: number };
    if (typeof counts.assigned === "number") assigned = counts.assigned;
    if (typeof counts.unserved === "number") unserved = counts.unserved;
  }

  // 4. Every house in the ZIP into a zone: the ones no route reached join
  //    the nearest housed route; then a zone per route, hard or walkable.
  const { error: adoptError } = await admin.rpc("zone_adopt_leftovers", { org, the_zip: zip });
  if (adoptError) throw adoptError;
  const { error: ensureError } = await admin.rpc("zone_ensure", { org, the_zip: zip });
  if (ensureError) throw ensureError;

  // A wave for every route with houses. Hard routes are waves too: they
  // are covered by scooter or vehicle, not left out.
  const { data: stored, error: storedError } = await admin
    .from("eddm_routes")
    .select("id, route_id, rings, walkability, walkability_reason, wave_id, zone_id, house_count, total_count")
    .eq("organization_id", org)
    .eq("zip", zip)
    .order("route_id");
  if (storedError) throw storedError;

  let wavesMade = 0;
  for (const row of stored ?? []) {
    if (row.wave_id || row.house_count === 0) continue;
    const points = wavePointsOf({ rings: (row.rings ?? []) as LngLatPair[][] }) ?? [];
    const { data: wave, error: waveError } = await admin
      .from("attractor_waves")
      .insert({
        organization_id: org,
        type_id: "door_hangers",
        name: `USPS ${zip} ${row.route_id}`,
        geometry_type: "polygon",
        geometry: { points } as unknown as Json,
        status: "planned",
        notes: `Zone ${zip} ${row.route_id}: ${row.house_count.toLocaleString()} of our houses, ${(row.total_count ?? 0).toLocaleString()} USPS deliveries.${row.walkability === "hard" && row.walkability_reason ? ` ${row.walkability_reason}.` : ""}`,
      })
      .select("id")
      .single();
    if (waveError) throw waveError;
    const { error: linkError } = await admin.from("eddm_routes").update({ wave_id: wave.id }).eq("id", row.id);
    if (linkError) throw linkError;
    wavesMade++;
  }

  // The hand-drawn waves go once there is something in their place.
  let replaced = checkpoint.replaced;
  if (!replaced && scope.replaceWaves.length > 0 && wavesMade > 0) {
    const { error: deleteError } = await admin.from("attractor_waves").delete().in("id", scope.replaceWaves).neq("type_id", "door_hangers");
    if (deleteError) throw deleteError;
    replaced = true;
  }

  const result: ZipResult = { ...judgedResult, waves: wavesMade, assigned, unserved, error: null };
  await admin
    .from("gis_import_jobs")
    .update({
      checkpoint: { ...checkpoint, attempts: 0, replaced, phase: "zones", zoneIndex: 0, zips: { ...checkpoint.zips, [zip]: result } } as unknown as Json,
      created: job.created + wavesMade,
      matched: job.matched + assigned,
      review: job.review + unserved,
      steps: job.steps + 1,
      last_error: null,
      lease_until: null,
      updated_at: now(),
    })
    .eq("id", job.id);

  return {
    status: "running",
    more: true,
    fetched: 0,
    message: `${zip}: ${assigned} houses on a route, ${unserved} adopted by the nearest, ${wavesMade} waves made. Zones next.`,
  };
}

/** How long the zones phase keeps building zones in one invocation. */
const ZONES_BUDGET_MS = 25_000;
/** Enclave passes per ZIP: the third finds almost nothing. */
const MAX_ENCLAVE_PASSES = 3;

/**
 * The third part of a ZIP: each zone's outline, walk, parking and mode,
 * settled against its neighbours so the county stays a partition. A zone
 * takes a second or two, so a ZIP of thirty takes a few invocations.
 */
async function buildZones(
  admin: Admin,
  job: JobRow,
  scope: EddmBuildScope,
  checkpoint: EddmBuildCheckpoint,
  zip: string
): Promise<StepOutcome> {
  const org = job.organization_id;
  const now = () => new Date().toISOString();
  const started = Date.now();
  const { data: zones, error } = await admin
    .from("hanger_zones")
    .select("id")
    .eq("organization_id", org)
    .eq("zip", zip)
    .not("eddm_route_id", "is", null)
    .order("id");
  if (error) throw error;
  const all = zones ?? [];
  let index = checkpoint.zoneIndex ?? 0;
  let fixQueue = [...(checkpoint.fixQueue ?? [])];
  let passes = checkpoint.passes ?? 0;
  const build = async (id: string) => {
    const { error: buildError } = await admin.rpc("zone_build", { the_zone: id });
    if (buildError) throw buildError;
    const { error: settleError } = await admin.rpc("zone_settle", { the_zone: id });
    if (settleError) throw settleError;
  };
  while (index < all.length && Date.now() - started < ZONES_BUDGET_MS) {
    await build(all[index].id);
    index++;
  }
  // Every zone outlined: no zone inside another. A few doors whose street
  // belonged to a neighbouring route sit as an island in the zone around
  // them; they are handed over, and both zones are rebuilt. Repeated until
  // nothing moves, up to three times.
  let finishedZip = false;
  if (index >= all.length) {
    while (fixQueue.length > 0 && Date.now() - started < ZONES_BUDGET_MS) {
      await build(fixQueue.shift()!);
    }
    if (fixQueue.length === 0 && Date.now() - started < ZONES_BUDGET_MS) {
      if (passes >= MAX_ENCLAVE_PASSES) {
        finishedZip = true;
      } else {
        // Hand enclaves to the zone around them; then any big piece still
        // on its own becomes a zone of its own. Both leave zones to rebuild.
        const { data: absorbed, error: absorbError } = await admin.rpc("zone_absorb_enclaves", { org, the_zip: zip });
        if (absorbError) throw absorbError;
        const moved = (absorbed ?? {}) as { moved?: number; affected?: string[] };
        const { data: split, error: splitError } = await admin.rpc("zone_split_pieces", { org, the_zip: zip });
        if (splitError) throw splitError;
        const made = (split ?? {}) as { made?: number; affected?: string[] };
        // And a zone too small to be a walk joins the neighbour beside it.
        const { data: merged, error: mergeError } = await admin.rpc("zone_merge_small", { org, the_zip: zip });
        if (mergeError) throw mergeError;
        const joined = (merged ?? {}) as { merged?: number; affected?: string[] };
        passes++;
        const touched = [...new Set([...(moved.affected ?? []), ...(made.affected ?? []), ...(joined.affected ?? [])])];
        if (touched.length === 0) finishedZip = true;
        else fixQueue = touched;
      }
    }
  }
  const next: EddmBuildCheckpoint = finishedZip
    ? { offset: checkpoint.offset + 1, attempts: 0, replaced: checkpoint.replaced, phase: "routes", zoneIndex: 0, fixQueue: [], passes: 0, zips: checkpoint.zips }
    : { ...checkpoint, attempts: 0, phase: "zones", zoneIndex: index, fixQueue, passes };
  const finished = finishedZip && next.offset >= scope.zips.length;
  await admin
    .from("gis_import_jobs")
    .update({
      checkpoint: next as unknown as Json,
      processed: job.processed + (finishedZip ? (checkpoint.zips[zip]?.routes ?? 0) : 0),
      steps: job.steps + 1,
      status: finished ? "done" : "running",
      finished_at: finished ? now() : null,
      last_error: null,
      lease_until: null,
      updated_at: now(),
    })
    .eq("id", job.id);
  return {
    status: finished ? "done" : "running",
    more: !finished,
    fetched: 0,
    message: `${zip}: ${index} of ${all.length} zones built${fixQueue.length ? `, ${fixQueue.length} to rebuild after enclaves` : ""}${finishedZip ? "." : ", more next tick."}`,
  };
}

function emptyResult(error: string): ZipResult {
  return { routes: 0, walkable: 0, hard: 0, unknown: 0, waves: 0, assigned: 0, unserved: 0, error };
}

interface JudgedRoute {
  route: EddmRoute;
  routeType: string | null;
  walkability: Walkability;
  reason: string | null;
  mainRoads: RoadHit[];
}

/**
 * Types and judges every route, looking up the map's roads only for the
 * routes USPS's type does not already settle, a few routes at a time.
 */
async function judgeRoutes(routes: EddmRoute[]): Promise<JudgedRoute[]> {
  const out: JudgedRoute[] = new Array(routes.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < routes.length) {
      const index = cursor++;
      const route = routes[index];
      const routeType = routeTypeOf(route);
      const facts: RouteFacts = { routeType, deliveries: route.total, streetKm: streetKm(route.paths) };
      if (!needsRoadCheck(facts) || route.paths.length === 0) {
        const settled = walkVerdict(facts, null);
        out[index] = { route, routeType, walkability: settled.walkability, reason: settled.reason, mainRoads: [] };
        continue;
      }
      const checks = await roadsAlong(route.paths);
      const verdict = walkVerdict(facts, checks);
      const seen = new Set<string>();
      const mainRoads = (checks ?? [])
        .flat()
        .filter((r) => MAIN_ROAD_CLASSES.has(r.class))
        .filter((r) => {
          const key = `${r.class}|${r.name ?? ""}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      out[index] = { route, routeType, walkability: verdict.walkability, reason: verdict.reason, mainRoads };
    }
  };
  await Promise.all(Array.from({ length: Math.min(ROAD_CONCURRENCY, routes.length) }, worker));
  return out;
}

/**
 * The roads at each of a handful of points along the route's streets, one
 * list per point that answered; null when the map could not be asked at all.
 */
async function roadsAlong(paths: LngLatPair[][]): Promise<RoadHit[][] | null> {
  if (!env.mapboxToken) return null;
  const checks: RoadHit[][] = [];
  for (const [lng, lat] of samplePoints(paths)) {
    try {
      const hits = await nearbyRoads({ lat, lng }, ROAD_LOOK_M, AbortSignal.timeout(6_000));
      checks.push(hits.filter((h) => h.roadClass).map((h) => ({ class: h.roadClass!, name: h.name ?? null })));
    } catch {
      // One point unanswered is not a verdict; the others still count.
    }
  }
  return checks.length > 0 ? checks : null;
}

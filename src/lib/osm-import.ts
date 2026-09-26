import { type JobRow, type StepOutcome } from "@/lib/gis-import-run";
import { OVERPASS_ENDPOINTS, overpassQuery, parseOverpass, type OsmCheckpoint, type OsmScope, type RoadSegmentRow } from "@/lib/osm-roads";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/**
 * The roads import, one tile an invocation.
 *
 * Same shape as the other imports: the scheduler posts a step, the step
 * asks Overpass for one tile's roads, writes them, and moves the
 * checkpoint on. Overpass is a shared public service that answers a big
 * tile in ten to forty seconds and says "not now" when busy, so one tile
 * a tick, and a busy answer leaves the checkpoint where it is for the
 * next tick, on the other mirror. When the last tile is in, the
 * organisation is marked as having new roads, and the zones' walks are
 * redrawn on them a few at a time by the database's own schedule.
 */

type Admin = ReturnType<typeof createAdminClient>;

const FETCH_TIMEOUT_MS = 52_000;
const MAX_TILE_ATTEMPTS = 8;
const LOAD_CHUNK = 12_000;

export async function runOsmSteps(admin: Admin, first: JobRow): Promise<StepOutcome> {
  return runOsmStep(admin, first);
}

async function release(admin: Admin, jobId: string, patch: Partial<JobRow>) {
  await admin
    .from("gis_import_jobs")
    .update({ ...patch, lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

export async function runOsmStep(admin: Admin, job: JobRow): Promise<StepOutcome> {
  const scope = (job.scope ?? {}) as Partial<OsmScope>;
  const tiles = scope.tiles ?? [];
  const checkpoint = { offset: 0, attempts: 0, ...((job.checkpoint ?? {}) as Partial<OsmCheckpoint>) };
  const org = job.organization_id;

  if (checkpoint.offset >= tiles.length) {
    await finish(admin, job);
    return { status: "done", more: false, fetched: 0, message: "Every tile is in." };
  }
  const tile = tiles[checkpoint.offset];
  const endpoint = OVERPASS_ENDPOINTS[checkpoint.attempts % OVERPASS_ENDPOINTS.length];

  let rows: RoadSegmentRow[];
  try {
    rows = await fetchTile(endpoint, overpassQuery(tile));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const attempts = checkpoint.attempts + 1;
    if (attempts >= MAX_TILE_ATTEMPTS) {
      await release(admin, job.id, { status: "failed", errors: job.errors + 1, last_error: `Tile ${tile.key}: ${message}`, finished_at: new Date().toISOString() });
      return { status: "failed", more: false, fetched: 0, message };
    }
    await release(admin, job.id, { checkpoint: { ...checkpoint, attempts } as unknown as Json, last_error: `Tile ${tile.key}: ${message} (will try again)` });
    return { status: "running", more: false, fetched: 0, message };
  }

  for (let i = 0; i < rows.length; i += LOAD_CHUNK) {
    const { error } = await admin.rpc("roads_load_tile", {
      org,
      the_tile: tile.key,
      rows: rows.slice(i, i + LOAD_CHUNK) as unknown as Json,
      replace: i === 0,
    });
    if (error) throw error;
  }
  if (rows.length === 0) {
    const { error } = await admin.rpc("roads_load_tile", { org, the_tile: tile.key, rows: [] as unknown as Json, replace: true });
    if (error) throw error;
  }

  const next: OsmCheckpoint = { offset: checkpoint.offset + 1, attempts: 0 };
  const finished = next.offset >= tiles.length;
  await release(admin, job.id, {
    checkpoint: next as unknown as Json,
    fetched: job.fetched + rows.length,
    processed: job.processed + 1,
    steps: job.steps + 1,
    last_error: null,
  });
  if (finished) await finish(admin, { ...job, checkpoint: next as unknown as Json });
  return { status: finished ? "done" : "running", more: !finished, fetched: rows.length, message: `Tile ${tile.key}: ${rows.length} segments.` };
}

async function finish(admin: Admin, job: JobRow) {
  const stamp = new Date().toISOString();
  const { error } = await admin.from("organizations").update({ roads_updated_at: stamp }).eq("id", job.organization_id);
  if (error) console.error("[roads] could not mark the roads as new:", error.message);
  await release(admin, job.id, { status: "done", finished_at: stamp, last_error: null });
}

async function fetchTile(endpoint: string, query: string): Promise<RoadSegmentRow[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": "JS Landscaping field app (door-hanger walks; contact jordanjcollins22@gmail.com)",
        accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Overpass answered ${res.status}`);
    const body = (await res.json()) as unknown;
    const remark = body && typeof body === "object" ? (body as { remark?: string }).remark : undefined;
    if (remark && /timed out|too busy|runtime error/i.test(remark)) throw new Error(remark);
    return parseOverpass(body);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("Overpass took too long");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

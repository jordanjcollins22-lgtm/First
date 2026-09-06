import { parseCount, parseFeaturePage, queryUrl } from "@/lib/arcgis";
import { acquireLease, recordDiagnostic, type JobRow, type StepOutcome } from "@/lib/gis-import-run";
import { probeEndpoint } from "@/lib/gis-probe";
import { discoverSdatFields, ownershipFromRecord, sdatMappingIsUsable, sdatWhere, type SdatMapping } from "@/lib/sdat";
import { discoverLayer } from "@/lib/gis-import-run";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

/**
 * The State's assessment roll onto our houses, a page at a time.
 *
 * Same shape as the county import: the scheduler posts a step, the step
 * takes the next page of Harford's parcels from MD iMAP by keyset, reads
 * each into ownership facts, finds our house by its normalized address, and
 * writes the facts beside it. A parcel with no house of ours -- vacant
 * land, a shop, a parcel the county keys differently -- is counted and
 * passed over; the county's address master stays the master of what a
 * house is. Every write is an upsert on the house, so any page can be run
 * again.
 */

export const SDAT_KIND = "sdat";
const PAGE_SIZE = 1000;
const MIN_PAGE_SIZE = 100;
const MAX_PAGE_ATTEMPTS = 5;
const PAGE_FETCH_TIMEOUT_MS = 25_000;
const STEP_BUDGET_MS = 20_000;
/** How many keys one lookup asks the database for; a URL has a length. */
const LOOKUP_CHUNK = 150;
const WRITE_CHUNK = 500;

type Admin = ReturnType<typeof createAdminClient>;

export interface SdatScope {
  zips: string[];
  zipIsNumber: boolean;
}

export function sdatMappingOf(job: Pick<JobRow, "field_mapping">): SdatMapping | null {
  const raw = job.field_mapping;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as SdatMapping) : null;
}

export function describeSdatImport(job: Pick<JobRow, "status" | "fetched" | "matched" | "skipped" | "total_expected" | "last_error">): string {
  const progress = job.total_expected ? `${job.fetched.toLocaleString()} of ${job.total_expected.toLocaleString()} parcels` : `${job.fetched.toLocaleString()} parcels`;
  const totals = `${job.matched.toLocaleString()} houses matched, ${job.skipped.toLocaleString()} parcels without a house of ours`;
  if (job.status === "running") return `Reading the State's roll: ${progress}. ${totals}.`;
  if (job.status === "failed") return `Stopped at ${progress}: ${job.last_error ?? "unknown error"}. ${totals}.`;
  if (job.status === "paused") return `Paused at ${progress}. ${totals}.`;
  return `Read ${progress}. ${totals}.`;
}

export async function runSdatSteps(admin: Admin, first: JobRow): Promise<StepOutcome> {
  const started = Date.now();
  let job: JobRow | null = first;
  let outcome: StepOutcome = { status: first.status, more: false, fetched: 0, message: null };
  while (job) {
    outcome = await runSdatStep(admin, job);
    if (!outcome.more || outcome.status !== "running") break;
    if (Date.now() - started > STEP_BUDGET_MS) break;
    job = await acquireLease(admin, first.id);
  }
  return outcome;
}

async function release(admin: Admin, jobId: string, patch: Partial<JobRow>) {
  await admin
    .from("gis_import_jobs")
    .update({ ...patch, lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

/**
 * A job started without its layer read -- from the database, say -- reads it
 * on its first step: the fields, the mapping, the page size, all recorded
 * on the row as the start action would have.
 */
async function bootstrap(admin: Admin, job: JobRow): Promise<JobRow | null> {
  const discovery = await discoverLayer(job.layer_url || job.service_url, "background-job");
  const fields = discovery.description.fields;
  const mapping = discoverSdatFields(fields.map((f) => f.name));
  const usable = Boolean(discovery.layerUrl) && sdatMappingIsUsable(mapping);
  const diagnostics = [...(Array.isArray(job.diagnostics) ? (job.diagnostics as Json[]) : []), ...discovery.probes.map((p) => ({ ...p }) as unknown as Json)].slice(-25);
  if (!usable) {
    await release(admin, job.id, {
      status: "failed",
      diagnostics,
      discovered_fields: fields as unknown as Json,
      last_error: !discovery.probe.ok
        ? `The State's server did not answer: ${discovery.probe.message ?? discovery.probe.kind}`
        : !discovery.layerUrl
          ? `${job.service_url} is a ${discovery.description.kind}, not a layer.`
          : `The layer has no premise address field. Its fields: ${fields.map((f) => f.name).slice(0, 40).join(", ")}`,
      finished_at: new Date().toISOString(),
    });
    return null;
  }
  const zipField = fields.find((f) => f.name === mapping.zip);
  const scope = (job.scope ?? {}) as Partial<SdatScope>;
  const zipIsNumber = /Integer|Double|Single/i.test(zipField?.type ?? "");
  const { data, error } = await admin
    .from("gis_import_jobs")
    .update({
      layer_url: discovery.layerUrl,
      layer_name: discovery.layerName,
      max_record_count: discovery.description.maxRecordCount,
      discovered_fields: fields as unknown as Json,
      field_mapping: mapping as unknown as Json,
      scope: { ...scope, zipIsNumber, where: sdatWhere(mapping, scope.zips ?? [], zipIsNumber) } as unknown as Json,
      diagnostics,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** One page. Expects the caller to hold the lease. */
export async function runSdatStep(admin: Admin, first: JobRow): Promise<StepOutcome> {
  let job = first;
  if (!sdatMappingOf(job)) {
    const ready = await bootstrap(admin, job);
    if (!ready) return { status: "failed", more: false, fetched: 0, message: "The layer could not be read." };
    job = ready;
  }
  const mapping = sdatMappingOf(job);
  if (!job.layer_url || !mapping) {
    await release(admin, job.id, { status: "failed", last_error: "The layer has no address field to match on.", finished_at: new Date().toISOString() });
    return { status: "failed", more: false, fetched: 0, message: "No usable mapping." };
  }
  const scope = (job.scope ?? {}) as Partial<SdatScope>;
  const checkpoint = (job.checkpoint ?? {}) as { offset?: number; attempts?: number; lastObjectId?: number | null; objectIdField?: string | null };
  const offset = Math.max(0, Number(checkpoint.offset ?? 0));
  const attempts = Math.max(0, Number(checkpoint.attempts ?? 0));
  const afterObjectId = checkpoint.lastObjectId ?? null;
  const objectIdField = checkpoint.objectIdField ?? null;
  const where = sdatWhere(mapping, scope.zips ?? [], scope.zipIsNumber === true);

  if (attempts >= MAX_PAGE_ATTEMPTS) {
    await release(admin, job.id, { status: "failed", last_error: `The page at ${offset} was cut off ${attempts} times in a row. Resume to try again.` });
    return { status: "failed", more: false, fetched: 0, message: "Page kept timing out." };
  }
  const pageSize = Math.max(MIN_PAGE_SIZE, Math.min(PAGE_SIZE >> attempts, job.max_record_count ?? PAGE_SIZE));

  await admin
    .from("gis_import_jobs")
    .update({ checkpoint: { ...checkpoint, offset, attempts: attempts + 1 } as unknown as Json, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  let totalExpected = job.total_expected;
  if (totalExpected == null && offset === 0) {
    const countProbe = await probeEndpoint(queryUrl(job.layer_url, { where, offset: 0, pageSize: 1, countOnly: true }), "background-job");
    await recordDiagnostic(admin, job, countProbe);
    totalExpected = countProbe.ok ? parseCount(countProbe.body) : null;
  }

  const pageUrl = queryUrl(job.layer_url, { where, offset, pageSize, afterObjectId, objectIdField, returnGeometry: false });
  const probe = await probeEndpoint(pageUrl, "background-job", PAGE_FETCH_TIMEOUT_MS);
  const page = parseFeaturePage(probe.body);
  if (!probe.ok || page.error) {
    await recordDiagnostic(admin, job, probe);
    const message = page.error ?? probe.message ?? "The State's server did not answer.";
    await release(admin, job.id, { status: "failed", errors: job.errors + 1, total_expected: totalExpected, last_error: `Page at ${offset}: ${message}` });
    return { status: "failed", more: false, fetched: 0, message };
  }
  if (offset === 0) await recordDiagnostic(admin, job, probe);

  const result = await applyPage(admin, job, mapping, page.features.map((f) => f.attributes));

  const nextOffset = offset + page.features.length;
  const more = page.features.length > 0 && (page.exceededTransferLimit || page.features.length >= pageSize);
  const finished = !more;
  await release(admin, job.id, {
    status: finished ? "done" : "running",
    fetched: job.fetched + page.features.length,
    processed: job.processed + result.read,
    matched: job.matched + result.matched,
    skipped: job.skipped + result.unmatched,
    total_expected: totalExpected,
    checkpoint: {
      offset: nextOffset,
      attempts: 0,
      lastObjectId: page.lastObjectId ?? afterObjectId,
      objectIdField: page.objectIdField ?? objectIdField,
    } as unknown as Json,
    steps: job.steps + 1,
    last_error: null,
    finished_at: finished ? new Date().toISOString() : null,
  });
  return { status: finished ? "done" : "running", more, fetched: page.features.length, message: null };
}

interface PageResult {
  read: number;
  matched: number;
  unmatched: number;
}

/** Reads a page's parcels, finds their houses, writes what the roll says. */
export async function applyPage(admin: Admin, job: JobRow, mapping: SdatMapping, attributes: Record<string, unknown>[]): Promise<PageResult> {
  const records = attributes.map((a) => ownershipFromRecord(a, mapping)).filter((r): r is NonNullable<typeof r> => r !== null);
  const byKey = new Map<string, (typeof records)[number]>();
  for (const record of records) {
    // Two parcels at one address (a condo's units keyed the same, a
    // duplicate account): the one with the later sale is the one that is
    // about the house today.
    const held = byKey.get(record.normalized);
    if (!held || (record.lastSaleDate ?? "") > (held.lastSaleDate ?? "")) byKey.set(record.normalized, record);
  }
  const keys = [...byKey.keys()];

  const houseIds = new Map<string, string>();
  for (let i = 0; i < keys.length; i += LOOKUP_CHUNK) {
    const chunk = keys.slice(i, i + LOOKUP_CHUNK);
    const { data, error } = await admin
      .from("houses")
      .select("id, normalized_address")
      .eq("organization_id", job.organization_id)
      .eq("kind", "house")
      .in("normalized_address", chunk);
    if (error) throw error;
    for (const row of data ?? []) {
      if (row.normalized_address && !houseIds.has(row.normalized_address)) houseIds.set(row.normalized_address, row.id);
    }
  }

  const now = new Date().toISOString();
  const rows = keys
    .filter((k) => houseIds.has(k))
    .map((k) => {
      const r = byKey.get(k)!;
      return {
        house_id: houseIds.get(k)!,
        organization_id: job.organization_id,
        account_id: r.accountId,
        owner_name: r.ownerName,
        owner_mailing: r.ownerMailing,
        owner_occupied: r.ownerOccupied,
        occupancy_reason: r.occupancyReason,
        principal_residence: r.principalResidence,
        last_sale_date: r.lastSaleDate,
        last_sale_price: r.lastSalePrice,
        year_built: r.yearBuilt,
        land_use: r.landUse,
        assessed_value: r.assessedValue,
        source_layer: job.layer_url,
        fetched_at: now,
      };
    });
  for (let i = 0; i < rows.length; i += WRITE_CHUNK) {
    const { error } = await admin.from("house_ownership").upsert(rows.slice(i, i + WRITE_CHUNK), { onConflict: "house_id" });
    if (error) throw error;
  }

  return { read: records.length, matched: rows.length, unmatched: keys.length - rows.length };
}

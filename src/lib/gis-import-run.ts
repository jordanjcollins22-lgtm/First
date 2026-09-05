import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import {
  describeEndpoint,
  layerUrl,
  metadataUrl,
  parseCount,
  parseFeaturePage,
  pickAddressLayer,
  queryUrl,
  zipWhere,
  type EndpointDescription,
} from "@/lib/arcgis";
import {
  discoverFields,
  mappingIsUsable,
  parcelFromFeature,
  resolveParcel,
  type ExistingHouse,
  type FieldMapping,
  type ParcelRecord,
} from "@/lib/gis-import";
import { houseNumber } from "@/lib/address-normalize";
import { NORMALIZER_VERSION, withinHarford } from "@/lib/address-quality";
import { probeEndpoint, type ProbeResult, type RequestOrigin } from "@/lib/gis-probe";
import type { Database, Json } from "@/lib/supabase/database.types";

/**
 * The county import, one page at a time.
 *
 * Runs on the server with the service-role client, never in a browser and
 * never for longer than one page. A step fetches a page from the layer,
 * decides each parcel against the houses we already hold, writes the results,
 * moves the checkpoint, and stops. Whether another step follows is the
 * caller's business (the step route chains them); this file only guarantees
 * that any step can be run again after any failure and the database ends up
 * the same.
 *
 * What a step never does: change a house's raw address, touch an event, or
 * link a parcel to a house on anything but an exact normalized-address match.
 */

export type JobRow = Database["public"]["Tables"]["gis_import_jobs"]["Row"];

const COUNTY = "Harford";
const SOURCE = "harford_gis";
/** How many parcels one step asks for. Sized to finish inside one function. */
const PAGE_SIZE = 400;
/** How long a step may hold a job before another runner may take it. */
const LEASE_MS = 120_000;

type Admin = ReturnType<typeof createAdminClient>;

/** Adds one probe to the job's diagnostics, newest last, bounded so the row stays readable. */
export async function recordDiagnostic(admin: Admin, job: Pick<JobRow, "id" | "diagnostics">, probe: ProbeResult) {
  const existing = Array.isArray(job.diagnostics) ? (job.diagnostics as Json[]) : [];
  // The parsed body is kept for a metadata answer (it is the schema) and
  // dropped for a page of features, which would be hundreds of kilobytes.
  const compact = { ...probe, body: probe.url.includes("/query?") ? null : probe.body } as unknown as Json;
  const next = [...existing, compact].slice(-25);
  await admin
    .from("gis_import_jobs")
    .update({ diagnostics: next, updated_at: new Date().toISOString() })
    .eq("id", job.id);
  job.diagnostics = next;
}

export interface DiscoveryResult {
  probe: ProbeResult;
  description: EndpointDescription;
  /** The layer that will actually be queried, once a catalog or service is resolved. */
  layerUrl: string | null;
  layerName: string | null;
  mapping: FieldMapping | null;
  /** Every probe made on the way, for the record. */
  probes: ProbeResult[];
}

/**
 * Finds out what is at a URL, and follows it down to a queryable layer.
 *
 * A catalog is reported and stops there, because choosing a service from a
 * list of thirty is a person's decision. A service is followed to its address
 * layer. A layer is read for its fields. Every hop is recorded.
 */
export async function discoverLayer(endpoint: string, runtime: RequestOrigin["runtime"]): Promise<DiscoveryResult> {
  const probes: ProbeResult[] = [];
  const first = await probeEndpoint(metadataUrl(endpoint), runtime);
  probes.push(first);
  const description = describeEndpoint(first.body);

  const failed = (probe: ProbeResult, desc: EndpointDescription): DiscoveryResult => ({
    probe,
    description: desc,
    layerUrl: null,
    layerName: null,
    mapping: null,
    probes,
  });

  if (!first.ok || description.error) return failed(first, description);

  if (description.kind === "layer") {
    return {
      probe: first,
      description,
      layerUrl: endpoint,
      layerName: description.layerName,
      mapping: discoverFields(description.fields.map((f) => f.name)),
      probes,
    };
  }

  if (description.kind === "service") {
    const chosen = pickAddressLayer(description.layers);
    if (!chosen) return failed(first, description);

    const target = layerUrl(endpoint, chosen.id);
    const second = await probeEndpoint(metadataUrl(target), runtime);
    probes.push(second);
    const layerDescription = describeEndpoint(second.body);
    if (!second.ok || layerDescription.kind !== "layer") {
      return { ...failed(second, layerDescription), layerName: chosen.name };
    }
    return {
      probe: second,
      // Keep the service's layer list on the description so the screen can
      // show what else was there.
      description: { ...layerDescription, layers: description.layers },
      layerUrl: target,
      layerName: layerDescription.layerName ?? chosen.name,
      mapping: discoverFields(layerDescription.fields.map((f) => f.name)),
      probes,
    };
  }

  return failed(first, description);
}

/** The counts an import is measured against, before and after. */
export async function totals(admin: Admin, organizationId: string): Promise<Json> {
  const { data, error } = await admin.rpc("gis_integrity_report", { org: organizationId });
  if (error) throw error;
  return data;
}

/** The where clause for a job's scope. */
export function whereFor(job: JobRow, mapping: FieldMapping): string {
  const scope = (job.scope ?? {}) as { zip?: string };
  if (job.kind === "zip" && scope.zip && mapping.address) {
    return zipWhere(scope.zip, mapping.zip, mapping.address);
  }
  return "1=1";
}

function mappingOf(job: JobRow): FieldMapping | null {
  const raw = job.field_mapping;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const mapping = raw as FieldMapping;
  return mappingIsUsable(mapping) ? mapping : null;
}

/** The URL a step calls itself back on. The deployment's own domain, so it is never a preview URL. */
export function selfBaseUrl(requestOrigin: string): string {
  if (env.appUrl) return env.appUrl.replace(/\/+$/, "");
  if (env.productionDomain) return `https://${env.productionDomain}`;
  return requestOrigin;
}

/**
 * Asks the next step to run. Fire and forget: the answer is a 202 and nothing
 * is learned from it. Failures to reach ourselves are written on the job so a
 * stalled chain is visible rather than mysterious.
 */
export async function kickStep(baseUrl: string, jobId: string): Promise<void> {
  if (!env.cronSecret) throw new Error("CRON_SECRET must be set for the import to run in the background.");
  const res = await fetch(`${baseUrl}/api/gis-import/step`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.cronSecret}`, "content-type": "application/json" },
    body: JSON.stringify({ jobId }),
    cache: "no-store",
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`The step route answered ${res.status}.`);
  }
}

/**
 * Takes the job for one step, or says no.
 *
 * Two runners on one job is the way a page gets written twice. The lease is
 * a timestamp checked and set in one conditional update, so only one of two
 * simultaneous callers gets a row back.
 */
export async function acquireLease(admin: Admin, jobId: string): Promise<JobRow | null> {
  const now = new Date();
  const { data, error } = await admin
    .from("gis_import_jobs")
    .update({ lease_until: new Date(now.getTime() + LEASE_MS).toISOString(), updated_at: now.toISOString() })
    .eq("id", jobId)
    .eq("status", "running")
    .or(`lease_until.is.null,lease_until.lt.${now.toISOString()}`)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function releaseLease(admin: Admin, jobId: string, patch: Partial<JobRow>) {
  await admin
    .from("gis_import_jobs")
    .update({ ...patch, lease_until: null, updated_at: new Date().toISOString() })
    .eq("id", jobId);
}

export interface StepOutcome {
  /** running | paused | done | failed */
  status: string;
  /** Whether the caller should ask for another step. */
  more: boolean;
  fetched: number;
  message: string | null;
}

/**
 * One page of the import.
 *
 * Expects the caller to hold the lease. Everything the page did is added to
 * the job's counters in one update at the end, after the checkpoint has been
 * earned; a step that dies halfway leaves the checkpoint where it was, and the
 * rerun of that page is harmless because every write below is idempotent.
 */
export async function runStep(admin: Admin, job: JobRow, runtime: RequestOrigin["runtime"]): Promise<StepOutcome> {
  const mapping = mappingOf(job);
  if (!job.layer_url || !mapping) {
    await releaseLease(admin, job.id, {
      status: "failed",
      last_error: "The layer has no usable address field, so nothing can be imported.",
      finished_at: new Date().toISOString(),
    });
    return { status: "failed", more: false, fetched: 0, message: "No usable address field." };
  }

  const checkpoint = (job.checkpoint ?? {}) as { offset?: number };
  const offset = Math.max(0, Number(checkpoint.offset ?? 0));
  const pageSize = Math.min(PAGE_SIZE, job.max_record_count ?? PAGE_SIZE);
  const where = whereFor(job, mapping);

  // The count is asked once, on the first page, so the screen can show
  // progress against something.
  let totalExpected = job.total_expected;
  if (totalExpected == null && offset === 0) {
    const countProbe = await probeEndpoint(queryUrl(job.layer_url, { where, offset: 0, pageSize: 1, countOnly: true }), runtime);
    await recordDiagnostic(admin, job, countProbe);
    totalExpected = countProbe.ok ? parseCount(countProbe.body) : null;
  }

  const pageUrl = queryUrl(job.layer_url, { where, offset, pageSize });
  const probe = await probeEndpoint(pageUrl, runtime, 40_000);
  const page = parseFeaturePage(probe.body);

  if (!probe.ok || page.error) {
    await recordDiagnostic(admin, job, probe);
    const message = page.error ?? probe.message ?? "The county did not answer.";
    await releaseLease(admin, job.id, {
      status: "failed",
      errors: job.errors + 1,
      total_expected: totalExpected,
      last_error: `Page at offset ${offset}: ${message}`,
    });
    return { status: "failed", more: false, fetched: 0, message };
  }

  // Only the first page's answer is kept as a diagnostic. Four hundred
  // identical successes would push the one that mattered out of the list.
  if (offset === 0) await recordDiagnostic(admin, job, probe);

  const result = await applyPage(admin, job, mapping, page.features);

  const nextOffset = offset + page.features.length;
  const more = page.features.length > 0 && (page.exceededTransferLimit || page.features.length >= pageSize);
  const finished = !more;

  await releaseLease(admin, job.id, {
    status: finished ? "done" : "running",
    fetched: job.fetched + page.features.length,
    processed: job.processed + result.processed,
    matched: job.matched + result.matched,
    created: job.created + result.created,
    skipped: job.skipped + result.skipped,
    review: job.review + result.review,
    duplicates_prevented: job.duplicates_prevented + result.duplicatesPrevented,
    errors: job.errors + result.errors,
    total_expected: totalExpected,
    checkpoint: { offset: nextOffset } as unknown as Json,
    steps: job.steps + 1,
    last_error: result.lastError,
    finished_at: finished ? new Date().toISOString() : null,
    after_totals: finished ? await totals(admin, job.organization_id) : null,
  });

  return { status: finished ? "done" : "running", more, fetched: page.features.length, message: null };
}

interface PageResult {
  processed: number;
  matched: number;
  created: number;
  skipped: number;
  review: number;
  duplicatesPrevented: number;
  errors: number;
  lastError: string | null;
}

/**
 * Decides and writes one page of parcels.
 *
 * Three lookups against the houses we hold, in order of certainty: by the
 * county's own parcel key (already imported -- nothing to decide), by exact
 * normalized address (ours -- enrich), and by house number for anything close
 * enough to ask about. What is left is new ground and is created in one batch
 * that ignores duplicates, so two runners or two runs cannot make two houses.
 */
async function applyPage(
  admin: Admin,
  job: JobRow,
  mapping: FieldMapping,
  features: { attributes: Record<string, unknown>; lat: number | null; lng: number | null }[]
): Promise<PageResult> {
  const out: PageResult = { processed: 0, matched: 0, created: 0, skipped: 0, review: 0, duplicatesPrevented: 0, errors: 0, lastError: null };
  const org = job.organization_id;

  const parcels: ParcelRecord[] = [];
  for (const [index, feature] of features.entries()) {
    const objectId = feature.attributes.OBJECTID ?? feature.attributes.objectid;
    const fallbackId = objectId != null ? String(objectId) : `row-${job.fetched + index}`;
    const mapped = parcelFromFeature(feature, mapping, fallbackId);
    out.processed++;
    if (!mapped.parcel) {
      out.skipped++;
      continue;
    }
    parcels.push(mapped.parcel);
  }
  if (parcels.length === 0) return out;

  // 1. Already linked by the county's key. A refresh, not a decision.
  const parcelIds = [...new Set(parcels.map((p) => p.parcelId))];
  const { data: linkedRows, error: linkedError } = await admin
    .from("houses")
    .select("id, parcel_id")
    .eq("organization_id", org)
    .eq("county", COUNTY)
    .in("parcel_id", parcelIds);
  if (linkedError) throw linkedError;
  const linked = new Set((linkedRows ?? []).map((r) => r.parcel_id));

  const undecided = parcels.filter((p) => {
    if (linked.has(p.parcelId)) {
      out.matched++;
      return false;
    }
    return true;
  });
  if (undecided.length === 0) return out;

  // 2 and 3. The houses that could possibly be these parcels: same normalized
  // address, or same house number. Nothing else can match, so nothing else is
  // fetched -- against ninety thousand houses, that is what keeps a page fast.
  const candidates = await candidateHouses(admin, org, undecided);

  const toCreate: Database["public"]["Tables"]["houses"]["Insert"][] = [];
  const reviews: Database["public"]["Tables"]["house_match_reviews"]["Insert"][] = [];

  for (const parcel of undecided) {
    const decision = resolveParcel(parcel, candidates);

    if (decision.action === "skip") {
      out.skipped++;
      continue;
    }

    if (decision.action === "enrich") {
      const enriched = await enrichHouse(admin, decision.houseId, parcel);
      if (enriched === "duplicate-link") out.duplicatesPrevented++;
      else if (enriched === "error") out.errors++;
      else out.matched++;
      continue;
    }

    if (decision.action === "review") {
      out.review++;
      reviews.push({
        organization_id: org,
        house_id: decision.candidateHouseId,
        score: Math.round(decision.score * 1000) / 1000,
        status: "pending",
        incoming_address: parcel.address,
        incoming_normalized: decision.normalized,
        parcel_id: parcel.parcelId,
        source: SOURCE,
      });
      continue;
    }

    // Create. A house the county knows and we have never spoken to: untouched,
    // which is what having no events means.
    const pin = parcel.lat != null && parcel.lng != null ? { lat: parcel.lat, lng: parcel.lng } : null;
    toCreate.push({
      organization_id: org,
      address: parcel.address,
      lat: pin?.lat ?? 0,
      lng: pin?.lng ?? 0,
      parcel_id: parcel.parcelId,
      county: COUNTY,
      owner_name: parcel.ownerName,
      lot_size_sqft: parcel.lotSizeSqft,
      source: SOURCE,
      source_updated_at: new Date().toISOString(),
      normalized_address: decision.normalized,
      address_normalizer_version: NORMALIZER_VERSION,
      kind: decision.kind,
      // A parcel with no readable geometry is still a house; it is held only
      // so nobody draws it at 0,0.
      needs_review: pin == null,
      review_reason: pin == null ? "The county gave no coordinates for this address" : null,
      gis_address: parcel.address,
      gis_matched_at: new Date().toISOString(),
    });
  }

  if (reviews.length > 0) {
    // One open question per house per incoming address; a rerun adds nothing.
    // Reviews are rare enough to write one at a time, and the index that
    // guarantees this is partial, which PostgREST cannot name in a batch.
    const inserted = await insertReviewsIndividually(admin, reviews);
    out.review = out.review - reviews.length + inserted;
  }

  if (toCreate.length > 0) {
    // Same normalized address twice in one page (two units the county wrote
    // identically) would make the batch conflict with itself.
    const unique = new Map<string, (typeof toCreate)[number]>();
    for (const row of toCreate) {
      const key = row.normalized_address ?? row.address;
      if (unique.has(key)) out.duplicatesPrevented++;
      else unique.set(key, row);
    }

    const rows = [...unique.values()];
    const { data: created, error } = await admin
      .from("houses")
      .upsert(rows, { onConflict: "organization_id,normalized_address", ignoreDuplicates: true })
      .select("id");
    if (!error) {
      out.created += created?.length ?? 0;
      // Anything the batch declined was a duplicate the index caught: a
      // house created by a parallel runner or an earlier page.
      out.duplicatesPrevented += rows.length - (created?.length ?? 0);
    } else if (error.code === "23505") {
      // A different unique rule fired -- the raw address, most likely -- and
      // took the whole batch down with it. One at a time finds the one row.
      for (const row of rows) {
        const { data: one, error: oneError } = await admin
          .from("houses")
          .upsert(row, { onConflict: "organization_id,normalized_address", ignoreDuplicates: true })
          .select("id");
        if (oneError) {
          if (oneError.code === "23505") out.duplicatesPrevented++;
          else {
            out.errors++;
            out.lastError = `Creating ${row.address}: ${oneError.message}`;
          }
        } else if (one && one.length > 0) out.created++;
        else out.duplicatesPrevented++;
      }
    } else {
      out.errors += rows.length;
      out.lastError = `Creating houses: ${error.message}`;
    }
  }

  return out;
}

/** The houses on this page's addresses or house numbers. Only these can match anything. */
async function candidateHouses(admin: Admin, org: string, parcels: ParcelRecord[]): Promise<ExistingHouse[]> {
  const numbers = [...new Set(parcels.map((p) => houseNumber(p.address)).filter((n): n is string => Boolean(n)))];
  const found = new Map<string, ExistingHouse>();

  // Chunked: a where clause with four hundred LIKEs in it is one the planner
  // handles badly, and the URL it travels in has a length limit.
  for (let i = 0; i < numbers.length; i += 40) {
    const chunk = numbers.slice(i, i + 40);
    const { data, error } = await admin
      .from("houses")
      .select("id, normalized_address")
      .eq("organization_id", org)
      .or(chunk.map((n) => `normalized_address.like.${n} %`).join(","));
    if (error) throw error;
    for (const row of data ?? []) found.set(row.id, { id: row.id, normalizedAddress: row.normalized_address });
  }

  return [...found.values()];
}

/**
 * Adds what the county knows to a house we already had.
 *
 * The raw address is not in the update. Neither is anything with a customer
 * or a dollar on it. Coordinates are replaced only when ours were the bad
 * half -- a pin outside the county, or none at all -- and the county's are
 * inside it; a house whose pin was fine keeps it.
 */
async function enrichHouse(
  admin: Admin,
  houseId: string,
  parcel: ParcelRecord
): Promise<"ok" | "duplicate-link" | "error"> {
  const { data: house, error: readError } = await admin
    .from("houses")
    .select("id, lat, lng, parcel_id, needs_review, review_reason, kind")
    .eq("id", houseId)
    .maybeSingle();
  if (readError || !house) return "error";

  // A different parcel already on this house is the county disagreeing with
  // itself, or two addresses on one lot. Neither is ours to settle here.
  if (house.parcel_id && house.parcel_id !== parcel.parcelId) return "duplicate-link";

  const now = new Date().toISOString();
  const patch: Database["public"]["Tables"]["houses"]["Update"] = {
    parcel_id: parcel.parcelId,
    county: COUNTY,
    owner_name: parcel.ownerName ?? undefined,
    lot_size_sqft: parcel.lotSizeSqft ?? undefined,
    gis_address: parcel.address,
    gis_matched_at: now,
    source_updated_at: now,
    updated_at: now,
  };

  const ourPinBad = !withinHarford(house.lat, house.lng);
  const countyPinGood = withinHarford(parcel.lat, parcel.lng);
  if (ourPinBad && countyPinGood && parcel.lat != null && parcel.lng != null) {
    patch.lat = parcel.lat;
    patch.lng = parcel.lng;
    // The hold was about the pin, and the pin is now the county's. An exact
    // address match is the confidence the rule asked for before correcting.
    if (house.needs_review && house.kind === "house") {
      patch.needs_review = false;
      patch.review_reason = null;
      patch.reviewed_at = now;
    }
  }

  const { error } = await admin.from("houses").update(patch).eq("id", houseId);
  if (error) {
    // The unique parcel index: this parcel is already on another house.
    if (error.code === "23505") return "duplicate-link";
    return "error";
  }
  return "ok";
}

/** The slow path for reviews when the batch cannot use the partial index. */
async function insertReviewsIndividually(
  admin: Admin,
  reviews: Database["public"]["Tables"]["house_match_reviews"]["Insert"][]
): Promise<number> {
  let inserted = 0;
  for (const review of reviews) {
    const { data: open } = await admin
      .from("house_match_reviews")
      .select("id")
      .eq("house_id", review.house_id)
      .eq("incoming_normalized", review.incoming_normalized ?? "")
      .eq("status", "pending")
      .maybeSingle();
    if (open) continue;
    const { error } = await admin.from("house_match_reviews").insert(review);
    if (!error) inserted++;
  }
  return inserted;
}

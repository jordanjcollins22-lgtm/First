"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { checkTabAccess } from "@/lib/data/access";
import { normalizeAddress as clientKey } from "@/lib/dedupe";
import { isMissingTable } from "@/lib/setup-errors";
import { parseFeaturePage, queryUrl } from "@/lib/arcgis";
import { DEFAULT_SOCRATA_SDAT_URL, isSocrataUrl, parseSocrataPage, socrataFieldNames, socrataFieldsUrl, socrataPageUrl } from "@/lib/socrata";
import { sdatMappingIsUsable } from "@/lib/sdat";
import {
  LEAD_FINDER_LEAD_SCORE,
  LEAD_FINDER_WEEKLY_COUNT,
  SERVICE_LABEL,
  cleanChecks,
  pickWeek,
  scoreProspect,
  suggestedServices,
  weekOf,
  type FinderCategory,
} from "@/lib/lead-finder";
import { dedupeParcels, discoverFinderFields, finderParcelFromRecord, finderSelect, finderWhere, type FinderParcel } from "@/lib/lead-finder-parcels";
import { SEED_PROSPECTS } from "@/lib/lead-finder-seed";
import { seedInsert } from "@/lib/lead-finder-view";

/**
 * The lead finder's writes: pull the roll's commercial parcels, load the
 * seed business list, fill this week's list, save a review, and turn a
 * high score into a prospect on the Leads page.
 *
 * Free public data only: the State's open-data portal (or an ArcGIS layer
 * of the same roll). No Google Places, no scraping; Street View is a link
 * the office opens by hand.
 */

// The table is newer than the generated types.
const untyped = (c: unknown) => c as SupabaseClient;
const PAGE = "/leads/finder";
/** One pull reads at most this many rows: our five ZIPs' non-residential parcels are well under it. */
const PULL_LIMIT = 5000;
const FETCH_TIMEOUT_MS = 25_000;
const MIGRATION_NOTE = "The lead finder needs its database update (0375_lead_finder.sql) first.";

export type FinderResult<T = null> = { ok: true; value: T; message?: string } | { ok: false; error: string };

async function guard<T>(name: string, work: () => Promise<FinderResult<T>>): Promise<FinderResult<T>> {
  try {
    return await work();
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (isMissingTable(e as never) || /lead_finder_parcels.*does not exist/i.test(e?.message ?? "")) return { ok: false, error: MIGRATION_NOTE };
    console.error(`[lead-finder] ${name} failed:`, err);
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong. Try again in a moment." };
  }
}

async function access() {
  const { allowed, profile } = await checkTabAccess("leads");
  if (!allowed || !profile) throw new Error("You don't have access to Leads.");
  const supabase = untyped(await createClient());
  return { profile, supabase, org: profile.organization_id as string };
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { accept: "application/json" }, cache: "no-store" });
  if (!res.ok) throw new Error(`The State's server answered ${res.status} for ${new URL(url).host}.`);
  return res.json();
}

/** Addresses already on the books: they are customers, not prospects. */
async function clientKeys(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase.from("properties").select("address");
  return new Set(((data ?? []) as { address: string | null }[]).map((p) => clientKey(p.address)).filter(Boolean));
}

/** Reads the roll's commercial, church, HOA and apartment parcels in our ZIPs. */
async function readRoll(source: string): Promise<FinderParcel[]> {
  if (isSocrataUrl(source)) {
    const names = socrataFieldNames(await getJson(socrataFieldsUrl(source)));
    const mapping = discoverFinderFields(names);
    if (!sdatMappingIsUsable(mapping)) throw new Error(`The portal's rows have no premise address. Fields: ${names.slice(0, 30).join(", ")}`);
    const page = parseSocrataPage(await getJson(socrataPageUrl(source, finderWhere(mapping), 0, PULL_LIMIT, finderSelect(mapping))));
    if (page.error) throw new Error(`The portal refused the request: ${page.error}`);
    return page.rows.map((r) => finderParcelFromRecord(r, mapping)).filter((p): p is FinderParcel => p != null);
  }
  // An ArcGIS layer of the same roll: one look for its fields, then the page.
  const probe = parseFeaturePage(await getJson(queryUrl(source, { where: "1=1", offset: 0, pageSize: 1, returnGeometry: false })));
  if (probe.error) throw new Error(probe.error);
  const mapping = discoverFinderFields(probe.fields.length ? probe.fields : Object.keys(probe.features[0]?.attributes ?? {}));
  if (!sdatMappingIsUsable(mapping)) throw new Error("That layer has no premise address field.");
  const page = parseFeaturePage(await getJson(queryUrl(source, { where: finderWhere(mapping), offset: 0, pageSize: PULL_LIMIT })));
  if (page.error) throw new Error(page.error);
  return page.features.map((f) => finderParcelFromRecord(f.attributes, mapping, { lat: f.lat, lng: f.lng })).filter((p): p is FinderParcel => p != null);
}

/**
 * Pulls the roll's non-residential parcels in Bel Air, Fallston, Forest
 * Hill and Abingdon. New parcels are added; ones already here keep their
 * review, and only their facts (lot, value, point) are refreshed.
 */
export async function pullLeadFinderParcels(source?: string): Promise<FinderResult<{ found: number; added: number }>> {
  return guard("pull", async () => {
    const { supabase, org } = await access();
    const url = (source ?? "").trim() || DEFAULT_SOCRATA_SDAT_URL;
    const clients = await clientKeys(supabase);
    const parcels = dedupeParcels(await readRoll(url)).filter((p) => !clients.has(clientKey(p.address)));

    const { data: existing, error: readError } = await supabase.from("lead_finder_parcels").select("source_key").eq("organization_id", org).eq("source", "sdat");
    if (readError) throw readError;
    const have = new Set(((existing ?? []) as { source_key: string }[]).map((r) => r.source_key));

    const rows = parcels.map((p) => ({
      organization_id: org,
      source: "sdat",
      source_key: p.sourceKey,
      name: p.name,
      category: p.category,
      address: p.address,
      address_key: p.addressKey,
      city: p.city,
      zip: p.zip,
      lat: p.lat,
      lng: p.lng,
      land_use: p.landUse,
      acreage: p.acreage,
      assessed_value: p.assessedValue,
      owner_name: p.ownerName,
      owner_mailing: p.ownerMailing,
      owner_state: p.ownerState,
      priority: p.priority,
      updated_at: new Date().toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("lead_finder_parcels").upsert(rows.slice(i, i + 500), { onConflict: "organization_id,source_key" });
      if (error) throw error;
    }
    const added = parcels.filter((p) => !have.has(p.sourceKey)).length;
    revalidatePath(PAGE);
    return { ok: true, value: { found: parcels.length, added }, message: `${parcels.length} parcels found, ${added} new.` };
  });
}

/** Loads the hand-made business list (44 places) as prospects. Already-loaded ones are left alone. */
export async function importLeadFinderSeeds(): Promise<FinderResult<{ added: number }>> {
  return guard("seeds", async () => {
    const { supabase, org } = await access();
    const clients = await clientKeys(supabase);
    const rows = SEED_PROSPECTS.filter((s) => !s.address || !clients.has(clientKey(s.address))).map((s) => ({ organization_id: org, ...seedInsert(s) }));
    const { data, error } = await supabase.from("lead_finder_parcels").upsert(rows, { onConflict: "organization_id,source_key", ignoreDuplicates: true }).select("id");
    if (error) throw error;
    revalidatePath(PAGE);
    const added = data?.length ?? 0;
    return { ok: true, value: { added }, message: `${added} places from the business list added.` };
  });
}

/** Tops this week's list up to the weekly count from the best properties nobody has looked at. */
export async function fillLeadFinderWeek(count = LEAD_FINDER_WEEKLY_COUNT): Promise<FinderResult<{ added: number }>> {
  return guard("week", async () => {
    const { supabase, org } = await access();
    const week = weekOf(new Date());
    const { data, error } = await supabase
      .from("lead_finder_parcels")
      .select("id, status, week_of, priority, acreage")
      .eq("organization_id", org)
      .or(`week_of.eq.${week},and(status.eq.new,week_of.is.null)`)
      .order("priority", { ascending: false })
      .limit(1000);
    if (error) throw error;
    const all = ((data ?? []) as { id: string; status: string; week_of: string | null; priority: number | string; acreage: number | string | null }[]).map((r) => ({
      id: r.id,
      status: r.status,
      weekOf: r.week_of,
      priority: Number(r.priority),
      acreage: r.acreage == null ? null : Number(r.acreage),
    }));
    const { added } = pickWeek(all, week, Math.max(1, Math.min(100, Math.floor(count))));
    if (added.length > 0) {
      const { error: upError } = await supabase.from("lead_finder_parcels").update({ week_of: week, updated_at: new Date().toISOString() }).in("id", added.map((a) => a.id));
      if (upError) throw upError;
    }
    revalidatePath(PAGE);
    return { ok: true, value: { added: added.length }, message: added.length ? `${added.length} added to this week's list.` : "Nothing left to add: pull the roll or load the business list." };
  });
}

interface ReviewFacts {
  id: string;
  name: string;
  category: FinderCategory;
  acreage: number | string | null;
  owner_state: string | null;
  land_use: string | null;
}

async function loadFacts(supabase: SupabaseClient, org: string, id: string) {
  const { data, error } = await supabase.from("lead_finder_parcels").select("*").eq("organization_id", org).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("That property isn't on the list any more.");
  return data as ReviewFacts & Record<string, unknown>;
}

/** Saves the office's look: the ticked boxes, the note. The score and services are worked out here, not trusted from the page. */
export async function saveLeadFinderReview(id: string, rawChecks: unknown, note: string | null): Promise<FinderResult<{ score: number }>> {
  return guard("review", async () => {
    const { supabase, org, profile } = await access();
    const row = await loadFacts(supabase, org, id);
    const checks = cleanChecks(rawChecks);
    const acreage = row.acreage == null ? null : Number(row.acreage);
    const result = scoreProspect(checks, { category: row.category, acreage, ownerState: row.owner_state, name: `${row.name} ${row.land_use ?? ""}` });
    const { error } = await supabase
      .from("lead_finder_parcels")
      .update({
        checks,
        score: result.score,
        services: suggestedServices(checks, row.category, acreage),
        note: note?.trim().slice(0, 1000) || null,
        status: row.status === "lead" ? "lead" : "reviewed",
        reviewed_at: new Date().toISOString(),
        reviewed_by: profile.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", org);
    if (error) throw error;
    revalidatePath(PAGE);
    return { ok: true, value: { score: result.score } };
  });
}

/** Not worth a look (closed, gone, a parking deck): off the list for good. */
export async function skipLeadFinderParcel(id: string): Promise<FinderResult> {
  return guard("skip", async () => {
    const { supabase, org } = await access();
    const { error } = await supabase.from("lead_finder_parcels").update({ status: "skipped", updated_at: new Date().toISOString() }).eq("id", id).eq("organization_id", org);
    if (error) throw error;
    revalidatePath(PAGE);
    return { ok: true, value: null };
  });
}

/**
 * Makes a scored property a prospect on the Leads page (lead_prospects),
 * queued to contact, with the services and the note, and links the two.
 * Only for a score at the lead line unless `force`.
 */
export async function makeLeadFromFinder(id: string, force = false): Promise<FinderResult<{ prospectId: string }>> {
  return guard("lead", async () => {
    const { supabase, org } = await access();
    const row = await loadFacts(supabase, org, id);
    const score = row.score == null ? null : Number(row.score);
    if (score == null) return { ok: false, error: "Score it first." };
    if (score < LEAD_FINDER_LEAD_SCORE && !force) return { ok: false, error: `Scores under ${LEAD_FINDER_LEAD_SCORE} get a letter, not a walk-in. Make it a lead anyway from the card if you mean to.` };

    const services = (Array.isArray(row.services) ? row.services : []) as (keyof typeof SERVICE_LABEL)[];
    const address = String(row.address);
    const notes = [
      `Lead finder ${score}/10: ${row.name}.`,
      services.length ? `Suggested: ${services.map((s) => SERVICE_LABEL[s] ?? s).join(", ")}.` : null,
      typeof row.note === "string" && row.note ? row.note : null,
      typeof row.owner_mailing === "string" && row.owner_mailing ? `Tax bill goes to ${row.owner_mailing}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const { data, error } = await supabase
      .from("lead_prospects")
      .upsert(
        {
          organization_id: org,
          source: "lead_finder",
          source_batch: `Lead finder ${row.week_of ?? weekOf(new Date())}`,
          owner_name: row.name,
          address,
          address_key: clientKey(address) || String(row.address_key),
          city: row.city ?? null,
          state: "MD",
          zip: row.zip ?? null,
          lat: row.lat ?? null,
          lng: row.lng ?? null,
          acreage: row.acreage ?? null,
          assessed_value: row.assessed_value ?? null,
          phone: row.phone ?? null,
          score: score * 10,
          status: "queued",
          notes,
        },
        { onConflict: "organization_id,address_key" }
      )
      .select("id")
      .single();
    if (error) throw error;
    const prospectId = (data as { id: string }).id;
    const { error: linkError } = await supabase
      .from("lead_finder_parcels")
      .update({ status: "lead", lead_prospect_id: prospectId, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("organization_id", org);
    if (linkError) throw linkError;
    revalidatePath(PAGE);
    revalidatePath("/leads");
    return { ok: true, value: { prospectId }, message: "Added to Prospects on the Leads page." };
  });
}

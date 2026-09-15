import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";
import { summariseBatches, type BatchSummary } from "@/lib/import-batches";

export interface ProspectRow {
  id: string;
  ownerName: string | null;
  address: string;
  city: string | null;
  zip: string | null;
  acreage: number | null;
  estimatedTicket: number | null;
  score: number | null;
  status: "new" | "queued" | "contacted" | "converted" | "rejected";
  doNotContact: boolean;
  phone: string | null;
  batch: string | null;
}

export interface ProspectsData {
  prospects: ProspectRow[];
  batches: string[];
  /** Missing the lot size that drives the estimate — the enrich button's queue. */
  needsEnrichment: number;
  /** The table doesn't exist yet, i.e. migration 0076 hasn't been run. */
  migrationMissing: boolean;
}

const PAGE_SIZE = 100;

export async function getProspects(): Promise<ProspectsData> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lead_prospects")
    .select("id, owner_name, address, city, zip, acreage, estimated_ticket, score, status, do_not_contact, phone, source_batch")
    .order("do_not_contact", { ascending: true })
    .order("score", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE);

  if (error) {
    // 42P01 is "table does not exist" — the page explains the migration rather
    // than showing an error nobody can act on.
    const missing = error.code === "42P01" || /does not exist/i.test(error.message);
    if (missing) {
      return { prospects: [], batches: [], needsEnrichment: 0, migrationMissing: true };
    }
    throw error;
  }

  const prospects: ProspectRow[] = (data ?? []).map((p) => ({
    id: p.id,
    ownerName: p.owner_name,
    address: p.address,
    city: p.city,
    zip: p.zip,
    acreage: p.acreage != null ? Number(p.acreage) : null,
    estimatedTicket: p.estimated_ticket != null ? Number(p.estimated_ticket) : null,
    score: p.score,
    status: (p.status as ProspectRow["status"]) ?? "new",
    doNotContact: p.do_not_contact,
    phone: p.phone,
    batch: p.source_batch,
  }));

  const batches = [...new Set(prospects.map((p) => p.batch).filter((b): b is string => Boolean(b)))].sort();

  return {
    prospects,
    batches,
    needsEnrichment: prospects.filter((p) => p.acreage == null && !p.doNotContact).length,
    migrationMissing: false,
  };
}

/**
 * Just the coordinates, for counting doors inside a drawn area.
 *
 * Deliberately narrow: the door-hanger count needs a position, a zip and
 * whether somebody has asked us to stop, and pulling whole prospect rows to
 * answer "how many houses" would read a bought list of thousands into memory
 * to produce one number.
 */
export async function listProspectAddresses(): Promise<
  { lat: number | null; lng: number | null; zip: string | null; doNotContact: boolean }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("lead_prospects").select("lat, lng, zip, do_not_contact");
  if (error) return [];

  return ((data ?? []) as unknown as {
    lat: number | null;
    lng: number | null;
    zip: string | null;
    do_not_contact: boolean;
  }[]).map((p) => ({ lat: p.lat, lng: p.lng, zip: p.zip, doNotContact: p.do_not_contact }));
}

/**
 * Every import batch, with what can safely come back out.
 *
 * Reads every prospect rather than the first page: the whole point is to
 * count a three thousand row import, and a page of a hundred would tell
 * somebody they had imported a hundred.
 */
export async function listImportBatches(): Promise<BatchSummary[]> {
  const supabase = await createClient();

  const [{ data: prospects, error }, { data: touches }] = await Promise.all([
    supabase.from("lead_prospects").select("id, source_batch, status, do_not_contact"),
    supabase.from("outreach_touches").select("prospect_id"),
  ]);

  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }

  // Anybody we have actually reached out to. Their row is history now, not
  // import data, so no cleanup is allowed to take it.
  const touched = new Set(
    ((touches ?? []) as { prospect_id: string | null }[])
      .map((t) => t.prospect_id)
      .filter((id): id is string => Boolean(id))
  );

  return summariseBatches(
    ((prospects ?? []) as {
      id: string;
      source_batch: string | null;
      status: string;
      do_not_contact: boolean;
    }[]).map((p) => ({
      id: p.id,
      batch: p.source_batch,
      status: p.status,
      doNotContact: p.do_not_contact,
      touched: touched.has(p.id),
    }))
  );
}

import { fetchJson } from "../http";
import type { PriceAnchor } from "../pricing";
import type { Opportunity } from "../types";

/**
 * USAspending.gov (no key). Two jobs:
 *  1. Price anchor — what the government paid for comparable work nearby
 *     (same NAICS/PSC, same state, ranked by zip/agency/keyword similarity).
 *  2. Candidate subs — companies that already performed this work in the
 *     state (they know federal paperwork and are SAM-registered).
 *
 * Gotchas (verified live): you can't filter on end date; contract and IDV
 * award types can't be mixed; place-of-performance is sometimes the office.
 */
const BASE = "https://api.usaspending.gov/api/v2";
const CONTRACT_TYPES = ["A", "B", "C", "D"];

export interface ComparableAward {
  awardId: string;
  recipientName: string;
  recipientUei: string | null;
  amount: number;
  startDate: string | null;
  endDate: string | null;
  subAgency: string | null;
  description: string;
  zip: string | null;
  annualAmount: number;
  similarity: number;
  url: string;
}

interface AwardRow {
  "Award ID": string;
  "Recipient Name": string;
  "Recipient UEI"?: string | null;
  "Award Amount": number;
  "Start Date"?: string | null;
  "End Date"?: string | null;
  "Awarding Sub Agency"?: string | null;
  Description?: string | null;
  "Place of Performance Zip5"?: string | null;
  generated_internal_id: string;
}

const STOPWORDS = new Set(["services", "service", "the", "and", "for", "at", "of", "in", "to", "a", "provide", "all", "labor", "igf", "ot", "contract", "base", "year", "with"]);

function words(s: string | null | undefined): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n;
}

export function annualize(amount: number, start: string | null, end: string | null): number {
  if (!start || !end) return amount;
  const years = (Date.parse(end) - Date.parse(start)) / (365.25 * 86_400_000);
  return Number.isFinite(years) && years > 1 ? amount / years : amount;
}

export function rankComparables(opp: Opportunity, rows: AwardRow[]): ComparableAward[] {
  const titleWords = words(opp.title);
  const officeWords = words(`${opp.agency ?? ""} ${opp.office ?? ""}`);
  const zip = opp.placeOfPerformance.zip;
  // Federal PIIDs start with the issuing office's 6-char code (e.g. FAA
  // "697DCK"), so a shared prefix means the same buying office.
  const office = opp.solicitationNumber?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) ?? "";
  return rows
    .filter((r) => r["Award Amount"] > 0)
    .map((r) => {
      const desc = r.Description ?? "";
      let similarity = 0;
      const rZip = r["Place of Performance Zip5"] ?? null;
      if (zip && rZip) {
        if (rZip === zip) similarity += 4;
        else if (rZip.slice(0, 3) === zip.slice(0, 3)) similarity += 2;
      }
      if (office.length === 6 && r["Award ID"].toUpperCase().replace(/[^A-Z0-9]/g, "").startsWith(office)) similarity += 3;
      similarity += Math.min(3, overlap(titleWords, words(desc)));
      similarity += Math.min(2, overlap(officeWords, words(r["Awarding Sub Agency"])));
      return {
        awardId: r["Award ID"],
        recipientName: r["Recipient Name"],
        recipientUei: r["Recipient UEI"] ?? null,
        amount: r["Award Amount"],
        startDate: r["Start Date"] ?? null,
        endDate: r["End Date"] ?? null,
        subAgency: r["Awarding Sub Agency"] ?? null,
        description: desc,
        zip: rZip,
        annualAmount: annualize(r["Award Amount"], r["Start Date"] ?? null, r["End Date"] ?? null),
        similarity,
        url: `https://www.usaspending.gov/award/${encodeURIComponent(r.generated_internal_id)}`,
      };
    })
    .sort((a, b) => b.similarity - a.similarity || (b.endDate ?? "").localeCompare(a.endDate ?? ""));
}

export async function findComparableAwards(opp: Opportunity, now = new Date()): Promise<ComparableAward[]> {
  const state = opp.placeOfPerformance.state;
  if (!state || (!opp.naicsCode && !opp.pscCode)) return [];
  const start = new Date(now.getTime() - 5 * 365 * 86_400_000).toISOString().slice(0, 10);
  const filters: Record<string, unknown> = {
    award_type_codes: CONTRACT_TYPES,
    place_of_performance_locations: [{ country: "USA", state }],
    time_period: [{ start_date: start, end_date: now.toISOString().slice(0, 10) }],
  };
  // PSC is usually the more specific code on service buys.
  if (opp.pscCode) filters.psc_codes = [opp.pscCode];
  else filters.naics_codes = [opp.naicsCode];

  const data = await fetchJson<{ results: AwardRow[] }>(`${BASE}/search/spending_by_award/`, {
    method: "POST",
    body: {
      filters,
      fields: [
        "Award ID",
        "Recipient Name",
        "Recipient UEI",
        "Award Amount",
        "Start Date",
        "End Date",
        "Awarding Sub Agency",
        "Description",
        "Place of Performance Zip5",
        "generated_internal_id",
      ],
      limit: 100,
      page: 1,
      sort: "End Date",
      order: "desc",
    },
  });
  return rankComparables(opp, data.results ?? []);
}

/**
 * Median annualized value of the most similar awards. Requires some real
 * similarity (same area or overlapping description) or returns null —
 * a bad anchor is worse than none.
 */
export function anchorFromComparables(comps: ComparableAward[]): PriceAnchor | null {
  const best = Math.max(0, ...comps.map((c) => c.similarity));
  const good = comps.filter((c) => c.similarity >= Math.max(4, best - 1)).slice(0, 5);
  if (!good.length) return null;
  const sorted = good.map((c) => c.annualAmount).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const top = good[0];
  return {
    annualAmount: median,
    source: `median of ${good.length} similar award(s), e.g. ${top.awardId} (${top.recipientName})`,
  };
}

export interface PastPerformer {
  name: string;
  uei: string | null;
  amount: number;
}

/** Firms paid for this NAICS/PSC in the state over the last 3 years. */
export async function findPastPerformers(opp: Opportunity, now = new Date()): Promise<PastPerformer[]> {
  const state = opp.placeOfPerformance.state;
  if (!state || (!opp.naicsCode && !opp.pscCode)) return [];
  const start = new Date(now.getTime() - 3 * 365 * 86_400_000).toISOString().slice(0, 10);
  const filters: Record<string, unknown> = {
    award_type_codes: CONTRACT_TYPES,
    recipient_locations: [{ country: "USA", state }],
    time_period: [{ start_date: start, end_date: now.toISOString().slice(0, 10) }],
  };
  if (opp.naicsCode) filters.naics_codes = [opp.naicsCode];
  else filters.psc_codes = [opp.pscCode];
  const data = await fetchJson<{ results: Array<{ name: string; uei?: string | null; amount: number }> }>(
    `${BASE}/search/spending_by_category/recipient/`,
    { method: "POST", body: { filters, limit: 25, page: 1 } }
  );
  return (data.results ?? []).map((r) => ({ name: r.name, uei: r.uei ?? null, amount: r.amount }));
}

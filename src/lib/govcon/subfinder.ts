import { searchPlaces, type PlaceResult } from "./sources/places";
import { findPastPerformers } from "./sources/usaspending";
import { findEmailOnWebsite } from "./sources/website-email";
import type { TradeDefinition } from "./trades";
import type { Opportunity } from "./types";

/**
 * Find local subcontractors near the place of performance. Merges:
 *  - Google Places text search for the trade near the job site (phone,
 *    website, rating) — the main source, like the manual "google it" step;
 *  - USAspending firms that already did this work in the state (federally
 *    experienced, SAM-registered — the best past-performance references).
 * Then scrapes each website for an email so the RFQ can go out unattended.
 * Subs with only a phone number land on the dashboard's call list.
 */
export interface SubCandidate {
  name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  rating: number | null;
  reviewCount: number | null;
  placeId: string | null;
  uei: string | null;
  pastFederalAmount: number | null;
  source: "google_places" | "usaspending";
  rank: number;
}

export function normalizeBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(llc|inc|incorporated|corp|corporation|co|company|ltd|l\.l\.c|pllc|lp)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function fromPlace(p: PlaceResult, source: SubCandidate["source"]): SubCandidate {
  return {
    name: p.name,
    phone: p.phone,
    email: null,
    website: p.website,
    address: p.address,
    city: p.city,
    state: p.state,
    zip: p.zip,
    rating: p.rating,
    reviewCount: p.reviewCount,
    placeId: p.placeId,
    uei: null,
    pastFederalAmount: null,
    source,
    rank: 0,
  };
}

/** Higher is better: reachable, well reviewed, federally experienced. */
export function rankCandidate(c: SubCandidate): number {
  let r = 0;
  if (c.email) r += 4;
  if (c.website) r += 1;
  if (c.phone) r += 1;
  if (c.rating !== null && c.rating >= 4.3 && (c.reviewCount ?? 0) >= 10) r += 3;
  else if (c.rating !== null && c.rating >= 4) r += 1;
  if ((c.reviewCount ?? 0) >= 50) r += 1;
  if (c.pastFederalAmount) r += 3;
  return r;
}

export function locationLabel(opp: Opportunity, override?: { city?: string | null; state?: string | null; zip?: string | null }): string | null {
  const city = override?.city ?? opp.placeOfPerformance.city;
  const state = override?.state ?? opp.placeOfPerformance.state;
  const zip = override?.zip ?? opp.placeOfPerformance.zip;
  if (!state && !zip) return null;
  return [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export async function findSubCandidates(input: {
  opp: Opportunity;
  trade: TradeDefinition;
  placesApiKey?: string | null;
  location?: { city?: string | null; state?: string | null; zip?: string | null };
  maxCandidates?: number;
}): Promise<SubCandidate[]> {
  const { opp, trade, placesApiKey } = input;
  const max = input.maxCandidates ?? 12;
  const where = locationLabel(opp, input.location);
  const byName = new Map<string, SubCandidate>();
  const add = (c: SubCandidate) => {
    const key = normalizeBusinessName(c.name);
    const existing = byName.get(key);
    if (!existing) byName.set(key, c);
    else {
      // Merge: keep contact details from whichever source had them.
      byName.set(key, {
        ...existing,
        phone: existing.phone ?? c.phone,
        website: existing.website ?? c.website,
        uei: existing.uei ?? c.uei,
        pastFederalAmount: existing.pastFederalAmount ?? c.pastFederalAmount,
      });
    }
  };

  if (placesApiKey && where) {
    for (const p of await searchPlaces(placesApiKey, `${trade.subSearchQuery} near ${where}`)) {
      add(fromPlace(p, "google_places"));
    }
  }

  // Federally experienced firms in the state; look up their contact info.
  const performers = await findPastPerformers(opp).catch(() => []);
  for (const pf of performers.slice(0, 5)) {
    let place: PlaceResult | undefined;
    if (placesApiKey) {
      place = (await searchPlaces(placesApiKey, `${pf.name} ${opp.placeOfPerformance.state ?? ""}`, 1).catch(() => []))[0];
    }
    const base: SubCandidate = place
      ? fromPlace(place, "usaspending")
      : { ...fromPlace({ placeId: "", name: pf.name, address: null, phone: null, website: null, rating: null, reviewCount: null, lat: null, lng: null, city: null, state: opp.placeOfPerformance.state ?? null, zip: null }, "usaspending"), placeId: null };
    add({ ...base, name: place?.name ?? pf.name, uei: pf.uei, pastFederalAmount: pf.amount });
  }

  const candidates = [...byName.values()].filter((c) => c.phone || c.website);
  candidates.sort((a, b) => rankCandidate(b) - rankCandidate(a));
  const top = candidates.slice(0, max);

  // Email enrichment, a few sites at a time.
  for (let i = 0; i < top.length; i += 4) {
    await Promise.all(
      top.slice(i, i + 4).map(async (c) => {
        if (c.website && !c.email) c.email = await findEmailOnWebsite(c.website).catch(() => null);
      })
    );
  }
  for (const c of top) c.rank = rankCandidate(c);
  return top.sort((a, b) => b.rank - a.rank);
}

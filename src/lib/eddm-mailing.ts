import * as turf from "@turf/turf";

import type { LngLatPair } from "@/lib/eddm";

/**
 * What an EDDM mailing costs and needs, worked out from the routes in it.
 *
 * Every Door Direct Mail Retail is priced one flat rate per piece, so the
 * cost of a route is its pieces times the rate; there is no per-route price
 * to fetch. The rules that go with the price are the ones that stop an
 * order at the counter: whole routes only, no fewer than 200 pieces and no
 * more than 5,000 per ZIP per day, bundles of up to a hundred with a facing
 * slip on each, taken to the post office that serves the routes. All of
 * that is decided here, from the numbers, before anyone drives anywhere.
 *
 * Pure, because it decides what gets printed and paid for.
 */

export type Audience = "residential" | "all";

export interface MailingRoute {
  zip: string;
  routeId: string;
  residential: number | null;
  business: number | null;
  total: number | null;
  /** The post office the bundles go to, from USPS. */
  facility: string | null;
}

export interface MailingRates {
  /** Dollars per piece, USPS Retail. Null until entered. */
  postagePerPiece: number | null;
  /** Dollars per piece to print in-house. */
  printCostPerPiece: number;
}

export const EDDM_MIN_PER_ZIP = 200;
export const EDDM_MAX_PER_ZIP_PER_DAY = 5000;
export const BUNDLE_SIZE = 100;

/** How many pieces a route takes for the chosen audience. */
export function piecesFor(route: MailingRoute, audience: Audience): number {
  if (audience === "all") return route.total ?? (route.residential ?? 0) + (route.business ?? 0);
  return route.residential ?? Math.max(0, (route.total ?? 0) - (route.business ?? 0));
}

export interface ZipCheck {
  zip: string;
  pieces: number;
  routes: number;
  ok: boolean;
  /** Why it would be refused at the counter, when it would be. */
  problem: string | null;
}

export interface MailingSummary {
  pieces: number;
  routes: number;
  postageCents: number | null;
  printCents: number;
  totalCents: number | null;
  perZip: ZipCheck[];
  /** Every post office involved. Usually one; a mailing across ZIPs may need two drops. */
  facilities: string[];
  bundles: number;
}

function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function mailingSummary(routes: MailingRoute[], audience: Audience, rates: MailingRates): MailingSummary {
  const perZipMap = new Map<string, ZipCheck>();
  let pieces = 0;
  for (const route of routes) {
    const n = piecesFor(route, audience);
    pieces += n;
    const entry = perZipMap.get(route.zip) ?? { zip: route.zip, pieces: 0, routes: 0, ok: true, problem: null };
    entry.pieces += n;
    entry.routes += 1;
    perZipMap.set(route.zip, entry);
  }
  const perZip = [...perZipMap.values()]
    .map((z) => {
      if (z.pieces < EDDM_MIN_PER_ZIP) {
        return { ...z, ok: false, problem: `Under the ${EDDM_MIN_PER_ZIP}-piece minimum for a ZIP; add a route in ${z.zip}` };
      }
      if (z.pieces > EDDM_MAX_PER_ZIP_PER_DAY) {
        return { ...z, ok: false, problem: `Over ${EDDM_MAX_PER_ZIP_PER_DAY.toLocaleString()} pieces for one day in ${z.zip}; split across days` };
      }
      return z;
    })
    .sort((a, b) => a.zip.localeCompare(b.zip));

  const postageCents = rates.postagePerPiece != null ? Math.round(pieces * cents(rates.postagePerPiece)) : null;
  const printCents = Math.round(pieces * cents(rates.printCostPerPiece));

  return {
    pieces,
    routes: routes.length,
    postageCents,
    printCents,
    totalCents: postageCents == null ? null : postageCents + printCents,
    perZip,
    facilities: [...new Set(routes.map((r) => r.facility).filter((f): f is string => Boolean(f)))].sort(),
    bundles: routes.reduce((sum, r) => sum + bundlesFor(piecesFor(r, audience)).length, 0),
  };
}

/**
 * The bundles a route's pieces are tied into: full ones of a hundred and
 * whatever is left. Each gets a facing slip; a route of 620 is seven slips.
 */
export function bundlesFor(pieces: number, size = BUNDLE_SIZE): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(pieces));
  while (left > 0) {
    const n = Math.min(size, left);
    out.push(n);
    left -= n;
  }
  return out;
}

/** A name for a mailing nobody named: the ZIP and the routes in it. */
export function suggestedName(routes: MailingRoute[]): string {
  if (routes.length === 0) return "EDDM mailing";
  const zips = [...new Set(routes.map((r) => r.zip))].sort();
  const ids = routes.map((r) => r.routeId).sort();
  const shown = ids.length > 4 ? `${ids.slice(0, 4).join(", ")} +${ids.length - 4}` : ids.join(", ");
  return `EDDM ${zips.join("/")} ${shown}`;
}

/**
 * One outline round every route in a mailing, for the wave that records it.
 *
 * Neighbouring routes union into one shape. Routes that do not touch cannot,
 * so the fallback is the hull round all of them, which overstates the area
 * but never leaves a route outside it.
 */
export function unionBoundary(rings: LngLatPair[][]): LngLatPair[] | null {
  const polygons = rings
    .filter((ring) => ring.length >= 3)
    .map((ring) => {
      const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring : [...ring, ring[0]];
      return turf.polygon([closed]);
    });
  if (polygons.length === 0) return null;
  if (polygons.length === 1) return polygons[0].geometry.coordinates[0].slice(0, -1) as LngLatPair[];

  try {
    const merged = turf.union(turf.featureCollection(polygons));
    if (merged && merged.geometry.type === "Polygon") {
      return merged.geometry.coordinates[0].slice(0, -1) as LngLatPair[];
    }
  } catch {
    // Fall through to the hull.
  }
  const hull = turf.convex(turf.featureCollection(polygons.flatMap((p) => p.geometry.coordinates[0].map((c) => turf.point(c)))));
  return hull ? (hull.geometry.coordinates[0].slice(0, -1) as LngLatPair[]) : null;
}

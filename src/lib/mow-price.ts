import type { LngLat, LotData } from "@/lib/lot-map";

/**
 * The price of a mow, from the county's lot and nothing else.
 *
 * Built for one job: a stranger types their address and gets a price they
 * can pay for on the spot. The lawn is worked out from the lot: the county's
 * lot size, less the house, less a share for the driveway, beds and trees.
 * The price is a tier, not a number to the dollar, because a tier is what a
 * person can say back on the phone ("you're in our $55 size") and because the
 * estimate behind it is only good to within a tier anyway.
 *
 * Pure, so the sizing and the tiers are tested without a map or a database.
 */

/** Of what is left after the house, the share that is not grass: driveway, walks, beds, trees. */
export const NOT_GRASS_SHARE = 0.3;

/** Off the first mow, for the last-minute openings offer. */
export const FIRST_MOW_DISCOUNT = 0.15;

export interface MowTier {
  key: string;
  /** Up to and including this many square feet of lawn. */
  upToSqft: number;
  label: string;
  cents: number;
}

/**
 * Cheap enough for a yes on the spot, and enough that a full day of them is a
 * good day: around eighteen lawns at the middle tiers is a thousand dollars.
 */
export const MOW_TIERS: readonly MowTier[] = [
  { key: "small", upToSqft: 5_000, label: "Small lawn, up to 5,000 sq ft", cents: 45_00 },
  { key: "medium", upToSqft: 10_000, label: "Medium lawn, up to 10,000 sq ft", cents: 55_00 },
  { key: "large", upToSqft: 20_000, label: "Large lawn, up to 20,000 sq ft", cents: 70_00 },
  { key: "xl", upToSqft: 30_000, label: "Extra large lawn, up to 30,000 sq ft", cents: 90_00 },
  { key: "acre", upToSqft: 43_560, label: "Up to an acre of lawn", cents: 115_00 },
];

/** Square feet of a ring of map points, near enough for a lot or a house. */
export function ringAreaSqft(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  const lat0 = (ring.reduce((sum, p) => sum + p[1], 0) / ring.length) * (Math.PI / 180);
  const mPerDegLat = 110_574;
  const mPerDegLng = 111_320 * Math.cos(lat0);
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = [ring[i][0] * mPerDegLng, ring[i][1] * mPerDegLat];
    const [xj, yj] = [ring[j][0] * mPerDegLng, ring[j][1] * mPerDegLat];
    twice += xj * yi - xi * yj;
  }
  const squareMetres = Math.abs(twice) / 2;
  return squareMetres * 10.7639;
}

export interface LawnEstimate {
  lotSqft: number;
  houseSqft: number;
  lawnSqft: number;
}

/**
 * The lawn, from the lot. The county's own lot size when it has one, the
 * drawn property line when it doesn't. The house from its outline; the
 * county's structure figure is floor area, which counts every storey, so it
 * is only used when there is no outline, and then halved as a guess at one
 * floor. Null when there is no lot to go on.
 */
export function estimateLawn(lot: LotData | null): LawnEstimate | null {
  if (!lot) return null;
  const lotSqft = lot.lotSqft && lot.lotSqft > 0 ? lot.lotSqft : ringAreaSqft(lot.ring);
  if (!(lotSqft > 0)) return null;
  const houseSqft = lot.footprint ? ringAreaSqft(lot.footprint) : lot.structureSqft ? lot.structureSqft / 2 : 0;
  const open = Math.max(0, lotSqft - houseSqft);
  const lawnSqft = Math.round((open * (1 - NOT_GRASS_SHARE)) / 100) * 100;
  return { lotSqft: Math.round(lotSqft), houseSqft: Math.round(houseSqft), lawnSqft };
}

/** The tier a lawn falls in. Null past an acre, which a person prices. */
export function tierFor(lawnSqft: number): MowTier | null {
  return MOW_TIERS.find((tier) => lawnSqft <= tier.upToSqft) ?? null;
}

export function tierByKey(key: string): MowTier | null {
  return MOW_TIERS.find((tier) => tier.key === key) ?? null;
}

/** One tier up or down, for "my lawn is smaller/bigger than that". Null at either end. */
export function neighbourTier(key: string, step: -1 | 1): MowTier | null {
  const index = MOW_TIERS.findIndex((tier) => tier.key === key);
  if (index < 0) return null;
  return MOW_TIERS[index + step] ?? null;
}

export interface MowPrice {
  regularCents: number;
  discountCents: number;
  firstMowCents: number;
}

/** The first mow with the offer taken off, to the cent, rounded to whole dollars in the client's favour. */
export function firstMowPrice(tier: MowTier): MowPrice {
  const firstMowCents = Math.floor((tier.cents * (1 - FIRST_MOW_DISCOUNT)) / 100) * 100;
  return { regularCents: tier.cents, discountCents: tier.cents - firstMowCents, firstMowCents };
}

export function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

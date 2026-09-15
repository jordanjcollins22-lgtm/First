/**
 * Which courts are worth going after, and why.
 *
 * A court is a dead-end street: one way in, a ring of homes that all see
 * the truck and each other's front yards. Operations wants to own courts
 * rather than scatter jobs across the county, because a court is one
 * parking spot, one load-out, and a neighbour watching every hour of the
 * work. This scores each court out of a hundred from what the county and
 * our own records say about it, and says in words what earned the points,
 * so the office can argue with the ranking rather than take it on faith.
 */

export interface CourtStats {
  id: string;
  street: string;
  zip: string;
  locality: string | null;
  houseCount: number;
  lat: number;
  lng: number;
  /** How far the farthest home is from the middle, in metres. */
  spreadM: number | null;
  assessedMedian: number | null;
  ownerOccupied: number;
  ownershipKnown: number;
  detached: number;
  townhouse: number;
  condo: number;
  clients: number;
  touched: number;
  jobsDone: number;
  shopKm: number | null;
}

export interface ScorePart {
  key: "value" | "size" | "tight" | "type" | "owners" | "foothold" | "near";
  label: string;
  points: number;
  max: number;
  why: string;
}

export type CourtVerdict = "prime" | "strong" | "fair" | "weak";

export interface CourtScore {
  score: number;
  verdict: CourtVerdict;
  parts: ScorePart[];
  /** True when the court is mostly condos or apartments: not ours to work. */
  skip: boolean;
}

export const VERDICT_LABEL: Record<CourtVerdict, string> = {
  prime: "Prime",
  strong: "Strong",
  fair: "Fair",
  weak: "Weak",
};

export const VERDICT_COLOR: Record<CourtVerdict, string> = {
  prime: "#15803d",
  strong: "#65a30d",
  fair: "#d97706",
  weak: "#94a3b8",
};

function ramp(value: number, zeroAt: number, fullAt: number): number {
  if (fullAt === zeroAt) return value >= fullAt ? 1 : 0;
  const t = (value - zeroAt) / (fullAt - zeroAt);
  return Math.max(0, Math.min(1, t));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function money(n: number): string {
  return `$${Math.round(n / 1000)}k`;
}

/** Score one court. Pure: the same stats always give the same answer. */
export function scoreCourt(c: CourtStats): CourtScore {
  const parts: ScorePart[] = [];

  // What the homes are worth: the budget for the work.
  if (c.assessedMedian == null) {
    parts.push({ key: "value", label: "Home value", points: 8, max: 25, why: "county value unknown" });
  } else {
    const t = ramp(c.assessedMedian, 250_000, 650_000);
    parts.push({ key: "value", label: "Home value", points: round1(25 * t), max: 25, why: `assessed around ${money(c.assessedMedian)}` });
  }

  // How many doors one parking spot reaches. Under eight is thin; over
  // forty is a loop road rather than a court.
  let sizeT: number;
  if (c.houseCount <= 40) sizeT = ramp(c.houseCount, 3, 8);
  else sizeT = 1 - ramp(c.houseCount, 40, 100);
  parts.push({ key: "size", label: "Homes on the court", points: round1(15 * sizeT), max: 15, why: `${c.houseCount} homes` });

  // How tight the ring is: whether the crew walks between houses or drives.
  if (c.spreadM == null) {
    parts.push({ key: "tight", label: "Tightness", points: 7, max: 15, why: "spread unknown" });
  } else {
    const t = 1 - ramp(c.spreadM, 60, 200);
    parts.push({ key: "tight", label: "Tightness", points: round1(15 * t), max: 15, why: `farthest home ${Math.round(c.spreadM)} m from the middle` });
  }

  // Detached homes have the yards; townhouses have a strip; condos have a
  // management company.
  const known = c.detached + c.townhouse + c.condo;
  const mostlyCondo = known > 0 && c.condo > c.detached + c.townhouse;
  if (known === 0) {
    parts.push({ key: "type", label: "Home type", points: 5, max: 10, why: "home type unknown" });
  } else {
    const t = (c.detached + 0.5 * c.townhouse) / known;
    const why = mostlyCondo
      ? "mostly condos or apartments"
      : c.detached >= c.townhouse
        ? `${Math.round((100 * c.detached) / known)}% detached homes`
        : `${Math.round((100 * c.townhouse) / known)}% townhouses`;
    parts.push({ key: "type", label: "Home type", points: round1(10 * t), max: 10, why });
  }

  // Owners decide on their own yard; tenants ask a landlord.
  if (c.ownershipKnown === 0) {
    parts.push({ key: "owners", label: "Owner-occupied", points: 5, max: 10, why: "occupancy unknown" });
  } else {
    const share = c.ownerOccupied / c.ownershipKnown;
    parts.push({ key: "owners", label: "Owner-occupied", points: round1(10 * share), max: 10, why: `${Math.round(100 * share)}% owner-occupied` });
  }

  // A client already on the court is a yard the neighbours have seen and a
  // name to drop at the door.
  const foothold = c.clients >= 3 ? 15 : c.clients === 2 ? 13 : c.clients === 1 ? 10 : 0;
  const footWhy =
    c.clients > 0
      ? `${c.clients} client${c.clients === 1 ? "" : "s"} already here${c.jobsDone > 0 ? `, ${c.jobsDone} job${c.jobsDone === 1 ? "" : "s"} done` : ""}`
      : c.touched > 0
        ? `${c.touched} spoken to, no client yet`
        : "no client here yet";
  parts.push({ key: "foothold", label: "Foothold", points: foothold, max: 15, why: footWhy });

  // Drive time from the shop, every morning of the job.
  if (c.shopKm == null) {
    parts.push({ key: "near", label: "Near the shop", points: 5, max: 10, why: "distance unknown" });
  } else {
    const t = 1 - ramp(c.shopKm, 8, 25);
    parts.push({ key: "near", label: "Near the shop", points: round1(10 * t), max: 10, why: `${round1(c.shopKm * 0.621)} miles from the shop` });
  }

  let score = parts.reduce((sum, p) => sum + p.points, 0);
  if (mostlyCondo) score *= 0.3;
  score = Math.round(score);

  const verdict: CourtVerdict = score >= 70 ? "prime" : score >= 55 ? "strong" : score >= 40 ? "fair" : "weak";
  return { score, verdict, parts, skip: mostlyCondo };
}

export interface RankedCourt extends CourtStats {
  rank: number;
  score: number;
  verdict: CourtVerdict;
  parts: ScorePart[];
  skip: boolean;
}

/** Every court scored and put in order, best first. Condo courts sink. */
export function rankCourts(courts: CourtStats[]): RankedCourt[] {
  return courts
    .map((c) => ({ ...c, ...scoreCourt(c) }))
    .sort((a, b) => b.score - a.score || b.houseCount - a.houseCount || a.street.localeCompare(b.street))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

/** One court as the map hands it to the side panel. */
export interface CourtDetail {
  id: string;
  title: string;
  rank: number;
  score: number;
  verdict: CourtVerdict;
  houses: number;
  clients: number;
  touched: number;
  jobsDone: number;
  value: number | null;
  ownerPct: number | null;
  detached: number;
  townhouse: number;
  condo: number;
  spreadM: number | null;
  shopKm: number | null;
  edited: boolean;
  parts: ScorePart[];
  points: { lat: number; lng: number }[];
}

/** "Brook Hill Ct, Bel Air" from the county's shouting. */
export function courtTitle(c: Pick<CourtStats, "street" | "locality">): string {
  const street = titleCase(c.street);
  return c.locality ? `${street}, ${titleCase(c.locality)}` : street;
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** The three strongest reasons, for a label or a popup. */
export function topReasons(parts: ScorePart[], n = 3): string[] {
  return [...parts]
    .filter((p) => p.points > 0)
    .sort((a, b) => b.points / b.max - a.points / a.max || b.points - a.points)
    .slice(0, n)
    .map((p) => p.why);
}

/**
 * Rate coverage and duplicate services on the rate card.
 *
 * The report's prerequisite for auto-approving prices is that the rate card
 * is filled in: "most active services have no rate set". The inventory also
 * found the services list has duplicates, the same service entered twice
 * (often once as a built-in and once as a custom one an evaluator proposed
 * mid-quote), so filling in rates means filling them in twice and the two
 * drift. This finds both: the active services with no rate, and the groups
 * that look like one service, with the one to keep.
 *
 * Pure, so the matching is tested without a database.
 */

export interface ServiceRow {
  serviceTypeId: string;
  name: string;
  status: string;
  /** The sale price on the rate card, in dollars. Null when not set. */
  cost: number | null;
  costUnit: string | null;
  /** How many jobs, areas and options point at it, when known. */
  uses?: number;
}

/** A service has a rate when the rate card has a price on it. */
export function hasRate(row: Pick<ServiceRow, "cost">): boolean {
  return row.cost != null && Number.isFinite(row.cost) && row.cost > 0;
}

/** Active services with no rate, the ones holding prices back. Most used first. */
export function missingRates(rows: ServiceRow[]): ServiceRow[] {
  return rows
    .filter((r) => r.status === "active" && !hasRate(r))
    .sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0) || a.name.localeCompare(b.name));
}

const STOP = new Set(["and", "the", "a", "of", "service", "services", "&"]);
const SINGULAR: Record<string, string> = {
  bushes: "bush",
  beds: "bed",
  plants: "plant",
  shrubs: "shrub",
  leaves: "leaf",
  trees: "tree",
  gutters: "gutter",
  weeds: "weed",
};

/**
 * What a name boils down to for matching: lower case, no punctuation, plural
 * folded, filler words gone, words sorted. "Plant / Bush Removal", "bush &
 * plant removal" and "Plants and Bushes Removal" are one key.
 */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((w) => w && !STOP.has(w))
    .map((w) => SINGULAR[w] ?? (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .sort()
    .join(" ");
}

export interface DuplicateGroup {
  key: string;
  /** The one to keep: active, with a rate, most used, built-in over custom. */
  keep: ServiceRow;
  /** The ones to fold into it. */
  merge: ServiceRow[];
  /** Why that one was picked, for the button's caption. */
  why: string;
}

const isCustom = (id: string) => id.startsWith("custom-");

/** Groups of services that look like the same thing. Merged rows are already folded and are left out. */
export function findDuplicates(rows: ServiceRow[]): DuplicateGroup[] {
  const groups = new Map<string, ServiceRow[]>();
  for (const row of rows) {
    if (row.status === "merged" || row.status === "denied") continue;
    const key = nameKey(row.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const out: DuplicateGroup[] = [];
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    const ranked = [...list].sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        Number(hasRate(b)) - Number(hasRate(a)) ||
        (b.uses ?? 0) - (a.uses ?? 0) ||
        Number(isCustom(a.serviceTypeId)) - Number(isCustom(b.serviceTypeId)) ||
        a.serviceTypeId.localeCompare(b.serviceTypeId)
    );
    const keep = ranked[0];
    const reasons = [
      keep.status === "active" ? "active" : null,
      hasRate(keep) ? "has a rate" : null,
      (keep.uses ?? 0) > 0 ? `used ${keep.uses} time${keep.uses === 1 ? "" : "s"}` : null,
      !isCustom(keep.serviceTypeId) ? "built in" : null,
    ].filter(Boolean);
    out.push({ key, keep, merge: ranked.slice(1), why: reasons.length ? `Keeps "${keep.name}": ${reasons.join(", ")}.` : `Keeps "${keep.name}".` });
  }
  return out.sort((a, b) => a.keep.name.localeCompare(b.keep.name));
}

/**
 * Whether one service may be folded into another. Refused rather than
 * corrected, because a merge re-points real jobs.
 */
export function mergeBlocker(from: ServiceRow | undefined, into: ServiceRow | undefined): string | null {
  if (!from || !into) return "One of those services no longer exists.";
  if (from.serviceTypeId === into.serviceTypeId) return "That is the same service.";
  if (from.status === "merged") return `"${from.name}" was already merged.`;
  if (into.status !== "active") return `"${into.name}" isn't active, so nothing can be merged into it.`;
  return null;
}

/** Reads a typed rate: dollars, with commas or a $ allowed. Null for blank; NaN for nonsense. */
export function readRate(text: string): number | null {
  const t = text.replace(/[$,\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : NaN;
}

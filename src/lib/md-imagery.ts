/**
 * Maryland's statewide aerial photos (MD iMAP, mdgeodata.md.gov): a 3-inch
 * collection covering much of the state and a 6-inch one covering all of
 * it, each pieced together from flights in different years by region. Each
 * service says in its description which year covers which counties, e.g.
 *
 *   "flown in 2023 (Southern Western Shore: Anne Arundel, Calvert, ...),
 *    2024 (Eastern Shore), and 2025 (Northern Western Shore: Allegany, ...)"
 *
 * so the year of the photo over any address is read from there and the
 * county the address is in. Pure, so the reading is tested on the real text.
 */

export const EASTERN_SHORE = ["Caroline", "Cecil", "Dorchester", "Kent", "Queen Anne's", "Somerset", "Talbot", "Wicomico", "Worcester"];
export const WESTERN_SHORE = [
  "Allegany",
  "Anne Arundel",
  "Baltimore",
  "Baltimore City",
  "Calvert",
  "Carroll",
  "Charles",
  "Frederick",
  "Garrett",
  "Harford",
  "Howard",
  "Montgomery",
  "Prince George's",
  "St. Mary's",
  "Washington",
];

/** Every county by its key, longest names first so "baltimore city" wins over "baltimore". */
const KNOWN = [...EASTERN_SHORE, ...WESTERN_SHORE]
  .map((name) => ({ key: countyKey(name) }))
  .sort((a, b) => b.key.length - a.key.length);

/** Whether a county's key appears in some text as whole words. "baltimore" is not in "baltimore city". */
function containsWord(text: string, key: string): boolean {
  const at = ` ${text} `.indexOf(` ${key} `);
  if (at < 0) return false;
  // Baltimore County, written as plain "baltimore", is not found inside "baltimore city".
  return !(key === "baltimore" && ` ${text} `.slice(at, at + key.length + 7) === ` ${key} city`);
}

/** Places named in the descriptions that are towns, by their county. */
const TOWN_COUNTY: Record<string, string> = { gaithersburg: "Montgomery", rockville: "Montgomery" };

/**
 * A county's name, the same however it is written: "Prince George's County",
 * "PRINCE GEORGES", "St. Mary's", "Baltimore city" (the Census's spelling)
 * and "Baltimore City" all come out the same.
 */
export function countyKey(name: string): string {
  const k = name
    .toLowerCase()
    .replace(/[’'.]/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/\s+/g, " ")
    .trim();
  if (k === "baltimore city") return k;
  return k.replace(/\s*county$/, "").trim();
}

/** Which flight year covers which county, by countyKey. */
export function parseFlightYears(description: string): Map<string, number> {
  const text = description.replace(/<[^>]+>/g, " ").replace(/&#39;|&apos;/g, "'").replace(/\s+/g, " ");
  const years = new Map<string, number>();
  const shoreWide: { year: number; counties: string[] }[] = [];
  for (const m of text.matchAll(/\b(19\d{2}|20\d{2})\s*\(([^)]*)\)/g)) {
    const year = Number(m[1]);
    const inside = m[2];
    const listed = inside.includes(":") ? inside.slice(inside.indexOf(":") + 1) : inside;
    if (!inside.includes(":") && /eastern shore/i.test(inside)) {
      shoreWide.push({ year, counties: EASTERN_SHORE });
      continue;
    }
    if (!inside.includes(":") && /western shore/i.test(inside)) {
      shoreWide.push({ year, counties: WESTERN_SHORE });
      continue;
    }
    for (const part of listed.split(/,|\band\b/)) {
      const name = part.trim();
      if (!name) continue;
      // The counties named in this piece, found by name: the published text
      // has run two together ("Prince George's St. Mary's") with no comma.
      const found = KNOWN.filter((k) => containsWord(countyKey(name), k.key));
      const keys = found.length > 0 ? found.map((k) => k.key) : [countyKey(TOWN_COUNTY[name.toLowerCase()] ?? name)];
      for (const key of keys) {
        if (!years.has(key) || years.get(key)! < year) years.set(key, year);
      }
    }
  }
  // A whole shore says nothing about the counties named on their own: those
  // keep their own year, and the rest of the shore takes the shore's.
  for (const { year, counties } of shoreWide) {
    for (const county of counties) {
      const key = countyKey(county);
      if (!years.has(key)) years.set(key, year);
    }
  }
  return years;
}

/** The newest year in a service's name, e.g. "SixInchImagery2023_2024_2025" is 2025. */
export function newestYearInName(name: string): number | null {
  const years = [...name.matchAll(/(?:19|20)\d{2}/g)].map((m) => Number(m[0]));
  return years.length > 0 ? Math.max(...years) : null;
}

export interface Candidate {
  id: string;
  year: number;
  /** Inches a pixel: smaller is sharper. */
  inches: number;
}

/** The photo to use: the newest, and of those the sharpest. */
export function pickNewest<T extends Candidate>(candidates: T[]): T | null {
  return [...candidates].sort((a, b) => b.year - a.year || a.inches - b.inches)[0] ?? null;
}

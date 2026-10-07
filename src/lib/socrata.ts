/**
 * Maryland's open-data portal, the other door to the same roll.
 *
 * The State publishes its assessment data on a Socrata portal as well as
 * on iMAP. The portal answers plain JSON: an array of flat rows, paged by
 * `$limit` and `$offset`, filtered by SoQL in `$where`, counted by
 * `$select=count(*)`. Same records, different grammar. Pure helpers for
 * that grammar; the fetching is the importer's.
 */

export const DEFAULT_SOCRATA_SDAT_URL = "https://opendata.maryland.gov/resource/ed4q-f8tm.json";

/** Whether a URL is a Socrata resource rather than an ArcGIS layer. */
export function isSocrataUrl(url: string): boolean {
  return /\/resource\/[a-z0-9]{4}-[a-z0-9]{4}(\.json)?(\?|$)/i.test(url) || /\/api\/views\//i.test(url);
}

/** The resource's base, with `.json` and no query. */
export function socrataBase(url: string): string {
  const clean = url.split("?")[0].replace(/\/+$/, "");
  return clean.endsWith(".json") ? clean : `${clean}.json`;
}

export function socrataFieldsUrl(url: string): string {
  const u = new URL(socrataBase(url));
  u.searchParams.set("$limit", "1");
  return u.toString();
}

export function socrataCountUrl(url: string, where: string): string {
  const u = new URL(socrataBase(url));
  u.searchParams.set("$select", "count(*)");
  if (where && where !== "1=1") u.searchParams.set("$where", where);
  return u.toString();
}

export function socrataPageUrl(url: string, where: string, offset: number, limit: number, fields: string[] = []): string {
  const u = new URL(socrataBase(url));
  // Only the columns we read: the roll has two hundred, and a page of a
  // thousand rows of all of them is megabytes for nothing.
  if (fields.length > 0) u.searchParams.set("$select", [...new Set(fields)].join(","));
  if (where && where !== "1=1") u.searchParams.set("$where", where);
  u.searchParams.set("$order", ":id");
  u.searchParams.set("$limit", String(Math.max(1, Math.floor(limit))));
  u.searchParams.set("$offset", String(Math.max(0, Math.floor(offset))));
  return u.toString();
}

/** The field names of a resource, from one row of it. */
export function socrataFieldNames(body: unknown): string[] {
  const row = Array.isArray(body) ? body[0] : null;
  return row && typeof row === "object" ? Object.keys(row as object) : [];
}

export function parseSocrataPage(body: unknown): { rows: Record<string, unknown>[]; error: string | null } {
  if (Array.isArray(body)) return { rows: body.filter((r) => r && typeof r === "object") as Record<string, unknown>[], error: null };
  if (body && typeof body === "object" && "message" in body) return { rows: [], error: String((body as { message: unknown }).message) };
  return { rows: [], error: "The portal answered with something that was not a list of rows." };
}

export function parseSocrataCount(body: unknown): number | null {
  const row = Array.isArray(body) ? body[0] : null;
  if (!row || typeof row !== "object") return null;
  const value = Object.values(row as Record<string, unknown>)[0];
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * The SoQL that keeps a request to Harford: by county name when the
 * resource has one, by our ZIPs otherwise. The jurisdiction code on the
 * portal is a number, not iMAP's letters, so it is not relied on.
 */
export function socrataWhere(fields: { county?: string; zip?: string }, zips: string[]): string {
  if (fields.county) return `upper(${fields.county}) like 'HARFORD%'`;
  if (fields.zip && zips.length > 0) return `${fields.zip} in (${zips.map((z) => `'${z}'`).join(",")})`;
  return "";
}

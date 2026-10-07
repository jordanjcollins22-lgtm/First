import type { NoticeType, SetAside } from "./types";

/** SAM.gov set-aside codes → our buckets. Sole-source codes map to "other"
 * because they're already promised to a specific firm. */
const SET_ASIDE_CODES: Record<string, SetAside> = {
  SBA: "small_business",
  SBP: "small_business",
  ESB: "small_business",
  "8A": "8a",
  HZC: "hubzone",
  SDVOSBC: "sdvosb",
  VSA: "vosb",
  WOSB: "wosb",
  EDWOSB: "edwosb",
  NONE: "none",
  "8AN": "other",
  HZS: "other",
  SDVOSBS: "other",
  VSS: "other",
  WOSBSS: "other",
  EDWOSBSS: "other",
  LAS: "other",
  IEE: "other",
  ISBEE: "other",
  BICIV: "other",
};

export function normalizeSetAside(code: string | null | undefined): SetAside {
  // The CSV occasionally wraps codes as JSON arrays: ["SBA"]
  const clean = (code ?? "").replace(/[[\]"\s]/g, "").split(",")[0].toUpperCase();
  if (!clean) return "none";
  return SET_ASIDE_CODES[clean] ?? "other";
}

export function normalizeNoticeType(type: string | null | undefined): NoticeType {
  const t = (type ?? "").toLowerCase().trim();
  if (t === "solicitation" || t === "o") return "solicitation";
  if (t.startsWith("combined synopsis") || t === "k") return "combined_synopsis_solicitation";
  if (t === "presolicitation" || t === "p") return "presolicitation";
  if (t === "sources sought" || t === "r") return "sources_sought";
  if (t === "special notice" || t === "s") return "special_notice";
  if (t === "award notice" || t === "a") return "award";
  return "other";
}

/** "2026-10-06 03:42:50" / "2026-10-06" / ISO → ISO string, or null. */
export function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(v) ? v.replace(" ", "T") + "Z" : v;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function parseMoney(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(value.replace(/[$,\s]/g, ""));
  return value.trim() && Number.isFinite(n) ? n : null;
}

export function blankToNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Strip HTML tags/entities from SAM descriptions for scoring and display. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null;
  return html
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * One solicitation can appear as several SAM notices (original + each
 * amendment, each with its own NoticeId). Key on agency + solicitation
 * number so amendments update a single opportunity instead of duplicating it.
 */
export function opportunityKey(opp: {
  externalId: string;
  solicitationNumber: string | null;
  agency: string | null;
}): string {
  const sol = opp.solicitationNumber?.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sol || sol.length < 4) return opp.externalId;
  const agency = (opp.agency ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24);
  return `${agency}:${sol}`;
}

/** Keep the most recently posted notice per opportunity key. */
export function latestByKey<T extends { externalId: string; solicitationNumber: string | null; agency: string | null; postedDate: string | null }>(
  items: T[]
): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = opportunityKey(item);
    const existing = map.get(key);
    if (!existing || (item.postedDate ?? "") > (existing.postedDate ?? "")) map.set(key, item);
  }
  return [...map.values()];
}

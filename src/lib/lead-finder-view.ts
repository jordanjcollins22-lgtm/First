import { normalizeAddress } from "@/lib/address-normalize";
import { cleanChecks, pickWeek, rankParcel, type FinderCategory, type FinderService, type RubricChecks } from "@/lib/lead-finder";
import { SEED_PROSPECTS, type SeedProspect } from "@/lib/lead-finder-seed";

/**
 * A lead-finder property as the review card shows it, from a database row
 * or from the seed list (the review page without the migration). Pure.
 */
export interface FinderRow {
  id: string;
  source: "sdat" | "seed" | "manual";
  name: string;
  category: FinderCategory;
  /** The hand-made list's type ("Self-storage"), or the roll's land use. */
  typeLabel: string | null;
  address: string;
  city: string | null;
  zip: string | null;
  lat: number | null;
  lng: number | null;
  acreage: number | null;
  assessedValue: number | null;
  ownerName: string | null;
  ownerMailing: string | null;
  ownerState: string | null;
  phone: string | null;
  website: string | null;
  seedPriority: string | null;
  reason: string | null;
  priority: number;
  status: "new" | "reviewed" | "lead" | "skipped";
  weekOf: string | null;
  checks: RubricChecks;
  score: number | null;
  services: FinderService[];
  note: string | null;
}

const STATUSES = new Set(["new", "reviewed", "lead", "skipped"]);
const SOURCES = new Set(["sdat", "seed", "manual"]);

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A lead_finder_parcels row as the card's row. */
export function rowFromDb(r: Record<string, unknown>): FinderRow {
  const str = (k: string) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string) : null);
  return {
    id: String(r.id),
    source: (SOURCES.has(String(r.source)) ? r.source : "manual") as FinderRow["source"],
    name: str("name") ?? "Property",
    category: (str("category") ?? "commercial") as FinderCategory,
    typeLabel: str("land_use"),
    address: str("address") ?? "",
    city: str("city"),
    zip: str("zip"),
    lat: num(r.lat),
    lng: num(r.lng),
    acreage: num(r.acreage),
    assessedValue: num(r.assessed_value),
    ownerName: str("owner_name"),
    ownerMailing: str("owner_mailing"),
    ownerState: str("owner_state"),
    phone: str("phone"),
    website: str("website"),
    seedPriority: str("seed_priority"),
    // A seed's reason is stored as its first note; the office's note replaces it.
    reason: null,
    priority: num(r.priority) ?? 0,
    status: (STATUSES.has(String(r.status)) ? r.status : "new") as FinderRow["status"],
    weekOf: str("week_of"),
    checks: cleanChecks(r.checks),
    score: num(r.score),
    services: Array.isArray(r.services) ? (r.services.filter((s) => typeof s === "string") as FinderService[]) : [],
    note: str("note"),
  };
}

/** A seed prospect as a database row's values (without organization). */
export function seedInsert(s: SeedProspect) {
  const address = s.address || s.name;
  return {
    source: "seed" as const,
    source_key: s.key,
    name: s.name,
    category: s.category,
    address,
    address_key: normalizeAddress([address, s.city, `MD ${s.zip}`].join(", ")) || s.key,
    city: s.city,
    zip: s.zip,
    land_use: s.type,
    phone: s.phone,
    website: s.website,
    seed_priority: s.priority,
    services: s.services,
    note: s.reason,
    priority: rankParcel({ category: s.category, acreage: null, ownerState: null, name: `${s.name} ${s.type}`, assessedValue: null, seedPriority: s.priority }),
  };
}

/** The seed list as card rows: the review page's data when the table is not there yet. */
export function seedRows(week: string, count: number): FinderRow[] {
  const all: FinderRow[] = SEED_PROSPECTS.map((s) => {
    const v = seedInsert(s);
    return {
      id: s.key,
      source: "seed",
      name: s.name,
      category: s.category,
      typeLabel: s.type,
      address: v.address,
      city: s.city,
      zip: s.zip,
      lat: null,
      lng: null,
      acreage: null,
      assessedValue: null,
      ownerName: null,
      ownerMailing: null,
      ownerState: null,
      phone: s.phone,
      website: s.website,
      seedPriority: s.priority,
      reason: s.reason,
      priority: v.priority,
      status: "new",
      weekOf: null,
      checks: {},
      score: null,
      services: s.services,
      note: null,
    };
  });
  const { added } = pickWeek(all, week, count);
  return added.map((r) => ({ ...r, weekOf: week }));
}

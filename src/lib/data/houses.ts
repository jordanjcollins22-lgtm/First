import { createClient } from "@/lib/supabase/server";
import { displayStage, type HouseEvent, type RelationshipStage } from "@/lib/house-relationship";
import { streetPrefix } from "@/lib/address-quality";
import type { MapHouse } from "@/lib/house-geojson";

/**
 * Houses, and the ones a person still has to settle.
 *
 * A house is on the map when it is a house and nobody is holding it: an
 * address with no number is a street, and a Bel Air address pinned in Missouri
 * is a question rather than a location. Both are kept and neither is drawn.
 */

export interface HouseForReview {
  id: string;
  /** The raw address, exactly as it first arrived. */
  address: string;
  normalizedAddress: string | null;
  kind: string;
  reviewReason: string | null;
  lat: number | null;
  lng: number | null;
  /** The furthest this house has got with us, from its events. */
  stage: RelationshipStage;
  eventCount: number;
  /** Who we know at this address, if anybody. */
  contacts: string[];
  /**
   * The county's address for what looks like the same house, when it has one.
   *
   * A held address is nearly always a geocoder's mistake -- "102 Barton Court"
   * pinned in San Antonio -- and the county knows exactly one 102 Barton Ct.
   * Offering it saves typing and, more to the point, brings the county's pin.
   */
  countySuggestion: string | null;
  countyHouseId: string | null;
}

interface HouseRow {
  id: string;
  address: string;
  normalized_address: string | null;
  kind: string;
  review_reason: string | null;
  lat: number | null;
  lng: number | null;
  property_events: { kind: string; occurred_at: string }[] | null;
  house_contacts: { customers: { name: string } | null }[] | null;
}

function toReview(row: HouseRow): HouseForReview {
  const events: HouseEvent[] = (row.property_events ?? []).map((e) => ({
    kind: e.kind as HouseEvent["kind"],
    at: e.occurred_at,
  }));

  return {
    id: row.id,
    address: row.address,
    normalizedAddress: row.normalized_address,
    kind: row.kind,
    reviewReason: row.review_reason,
    lat: row.lat,
    lng: row.lng,
    stage: displayStage(events),
    eventCount: events.length,
    contacts: (row.house_contacts ?? [])
      .map((link) => link.customers?.name)
      .filter((name): name is string => Boolean(name)),
    countySuggestion: null,
    countyHouseId: null,
  };
}

/**
 * Finds, for each held house, the county's row for the same number and
 * street, when there is exactly one obvious candidate.
 *
 * Matched on the first three normalized words -- "102 BARTON CT" -- which is
 * the part a bad geocode leaves alone. Several county rows (a building and
 * its units) mean the shortest, unit-less one is offered; none means none.
 */
async function withCountySuggestions(houses: HouseForReview[]): Promise<HouseForReview[]> {
  const supabase = await createClient();
  const prefixes = new Map<string, HouseForReview[]>();
  for (const house of houses) {
    if (house.kind !== "house") continue;
    const prefix = streetPrefix(house.address, 3);
    if (!/^\d/.test(prefix) || prefix.split(" ").length < 3) continue;
    prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), house]);
  }
  const keys = [...prefixes.keys()];
  if (keys.length === 0) return houses;

  const found = new Map<string, { id: string; address: string; normalized: string }[]>();
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40);
    const { data, error } = await supabase
      .from("houses")
      .select("id, address, normalized_address")
      .eq("source", "harford_gis")
      .not("parcel_id", "is", null)
      .or(chunk.map((k) => `normalized_address.like.${k} %`).join(","));
    if (error) throw error;
    for (const row of data ?? []) {
      const normalized = row.normalized_address ?? "";
      const key = chunk.find((k) => normalized.startsWith(`${k} `));
      if (!key) continue;
      found.set(key, [...(found.get(key) ?? []), { id: row.id, address: row.address, normalized }]);
    }
  }

  return houses.map((house) => {
    const prefix = streetPrefix(house.address, 3);
    const candidates = found.get(prefix);
    if (!candidates || candidates.length === 0) return house;
    const best = [...candidates].sort((a, b) => a.normalized.length - b.normalized.length)[0];
    return { ...house, countySuggestion: best.address, countyHouseId: best.id };
  });
}

/**
 * What is waiting to be settled.
 *
 * Ordered so the ones with history come first: a held address that already has
 * an evaluation on it is somebody's actual customer, and getting that one
 * wrong costs more than getting a stranger's parcel wrong.
 */
export async function listHousesNeedingReview(limit = 200): Promise<HouseForReview[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("houses")
    .select(
      "id, address, normalized_address, kind, review_reason, lat, lng, property_events(kind, occurred_at), house_contacts(customers(name))"
    )
    .eq("needs_review", true)
    .is("reviewed_at", null)
    .order("address")
    .limit(limit);

  if (error) throw error;

  const reviews = ((data ?? []) as unknown as HouseRow[])
    .map(toReview)
    .sort((a, b) => b.eventCount - a.eventCount || a.address.localeCompare(b.address));
  return withCountySuggestions(reviews).catch(() => reviews);
}

export interface HouseCounts {
  total: number;
  /** On the map: a house, not held. */
  mappable: number;
  /** Waiting for a person. */
  held: number;
  /** Held, looked at, and deliberately left off. */
  settled: number;
}

/**
 * Counted in the database, not in memory. With the county loaded there are a
 * hundred and seventeen thousand houses, and a select of all of them stops
 * silently at the API's thousand-row page -- which is how the screen came to
 * say 939 were on the map.
 */
export async function houseCounts(): Promise<HouseCounts> {
  const supabase = await createClient();
  const count = async (apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count: n, error } = await apply(base());
    if (error) throw error;
    return n ?? 0;
  };
  const base = () => supabase.from("houses").select("id", { count: "exact", head: true });

  const [total, mappable, held, settled] = await Promise.all([
    count((q) => q),
    count((q) => q.eq("kind", "house").eq("needs_review", false)),
    count((q) => q.eq("needs_review", true).is("reviewed_at", null)),
    count((q) => q.not("reviewed_at", "is", null)),
  ]);
  return { total, mappable, held, settled };
}

/**
 * The houses with a story: anyone we know there, or anything that happened.
 *
 * These ride along with the Project Data page and are always drawn, coloured
 * by stage. They are a few hundred out of a hundred and seventeen thousand;
 * the rest are fetched by viewport when somebody asks for them.
 */
export async function listHousesWithHistory(): Promise<MapHouse[]> {
  const supabase = await createClient();

  const [{ data: contactRows, error: contactsError }, { data: eventRows, error: eventsError }] = await Promise.all([
    supabase.from("house_contacts").select("house_id"),
    supabase.from("property_events").select("house_id"),
  ]);
  if (contactsError) throw contactsError;
  if (eventsError) throw eventsError;

  const ids = [...new Set([...(contactRows ?? []), ...(eventRows ?? [])].map((r) => r.house_id))];
  if (ids.length === 0) return [];

  const houses: MapHouse[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from("houses")
      .select(
        "id, address, lat, lng, kind, needs_review, parcel_id, property_events(kind, occurred_at), house_contacts(customer_id, customers(name))"
      )
      .in("id", ids.slice(i, i + 200))
      .eq("kind", "house")
      .eq("needs_review", false);
    if (error) throw error;

    for (const row of (data ?? []) as unknown as {
      id: string;
      address: string;
      lat: number;
      lng: number;
      parcel_id: string | null;
      property_events: { kind: string; occurred_at: string }[] | null;
      house_contacts: { customer_id: string; customers: { name: string } | null }[] | null;
    }[]) {
      const events: HouseEvent[] = (row.property_events ?? []).map((e) => ({
        kind: e.kind as HouseEvent["kind"],
        at: e.occurred_at,
      }));
      houses.push({
        id: row.id,
        address: row.address,
        lat: Number(row.lat),
        lng: Number(row.lng),
        stage: displayStage(events),
        contacts: (row.house_contacts ?? [])
          .map((c) => c.customers?.name)
          .filter((name): name is string => Boolean(name)),
        customerId: row.house_contacts?.[0]?.customer_id ?? null,
        countyPin: row.parcel_id != null,
      });
    }
  }
  return houses;
}

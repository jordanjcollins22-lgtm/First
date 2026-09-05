import { createClient } from "@/lib/supabase/server";
import { displayStage, type HouseEvent, type RelationshipStage } from "@/lib/house-relationship";

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
  };
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

  return ((data ?? []) as unknown as HouseRow[])
    .map(toReview)
    .sort((a, b) => b.eventCount - a.eventCount || a.address.localeCompare(b.address));
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

export async function houseCounts(): Promise<HouseCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("houses").select("kind, needs_review, reviewed_at");
  if (error) throw error;

  const rows = (data ?? []) as { kind: string; needs_review: boolean; reviewed_at: string | null }[];

  return {
    total: rows.length,
    mappable: rows.filter((r) => r.kind === "house" && !r.needs_review).length,
    held: rows.filter((r) => r.needs_review && !r.reviewed_at).length,
    settled: rows.filter((r) => r.reviewed_at != null).length,
  };
}

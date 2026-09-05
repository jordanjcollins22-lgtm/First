import { createClient } from "@/lib/supabase/server";
import { displayStage, type HouseEvent, type RelationshipStage } from "@/lib/house-relationship";

/**
 * The county's near misses against houses of ours, waiting for a person.
 *
 * Each one is a parcel whose address was close to one we hold but not the
 * same: "991 Bern Drive" against "991 BERN DR UNIT 2B". The importer would
 * not guess, so it asked. What the reviewer sees is both addresses side by
 * side and what rides on the house of ours -- its stage and its people --
 * because getting a customer's house wrong costs more than a stranger's.
 */
export interface MatchReviewForScreen {
  id: string;
  houseId: string;
  houseAddress: string;
  houseSource: string | null;
  stage: RelationshipStage;
  eventCount: number;
  contacts: string[];
  incomingAddress: string;
  parcelId: string | null;
  score: number;
  /** Whether the parcel's pin was kept, so "different" can create it at once. */
  hasPin: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  house_id: string;
  incoming_address: string | null;
  parcel_id: string | null;
  score: number | string;
  incoming_lat: number | null;
  incoming_lng: number | null;
  created_at: string;
  houses: {
    address: string;
    source: string | null;
    property_events: { kind: string; occurred_at: string }[] | null;
    house_contacts: { customers: { name: string } | null }[] | null;
  } | null;
}

export async function listPendingMatchReviews(limit = 200): Promise<MatchReviewForScreen[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("house_match_reviews")
    .select(
      "id, house_id, incoming_address, parcel_id, score, incoming_lat, incoming_lng, created_at, houses(address, source, property_events(kind, occurred_at), house_contacts(customers(name)))"
    )
    .eq("status", "pending")
    .order("score", { ascending: false })
    .limit(limit);
  if (error) throw error;

  return ((data ?? []) as unknown as Row[])
    .filter((row) => row.houses)
    .map((row) => {
      const events: HouseEvent[] = (row.houses?.property_events ?? []).map((e) => ({
        kind: e.kind as HouseEvent["kind"],
        at: e.occurred_at,
      }));
      return {
        id: row.id,
        houseId: row.house_id,
        houseAddress: row.houses?.address ?? "",
        houseSource: row.houses?.source ?? null,
        stage: displayStage(events),
        eventCount: events.length,
        contacts: (row.houses?.house_contacts ?? [])
          .map((link) => link.customers?.name)
          .filter((name): name is string => Boolean(name)),
        incomingAddress: row.incoming_address ?? "",
        parcelId: row.parcel_id,
        score: Number(row.score),
        hasPin: row.incoming_lat != null && row.incoming_lng != null,
        createdAt: row.created_at,
      };
    });
}

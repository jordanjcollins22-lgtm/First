import {
  displayStage,
  RELATIONSHIP_STAGES,
  STAGE_COLOR,
  type HouseEvent,
  type RelationshipStage,
} from "@/lib/house-relationship";

/**
 * A house as the map draws it.
 *
 * Everything the marker and its popup need, and nothing else: the map holds
 * the whole county in memory when the toggle is on, and every extra byte per
 * house is a hundred thousand bytes.
 */
export interface MapHouse {
  id: string;
  address: string;
  lat: number;
  lng: number;
  stage: RelationshipStage;
  /** Who we know here, for the popup. */
  contacts: string[];
  /** The first contact's id, for the link into their record. */
  customerId: string | null;
  /** Whether the pin came from the county, which is the trustworthy kind. */
  countyPin: boolean;
}

export interface HouseFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: string;
    address: string;
    stage: RelationshipStage;
    color: string;
    contacts: string;
    customerId: string | null;
  };
}

/** Houses with somewhere to be drawn, as features. A house at 0,0 is not one. */
export function housesToFeatures(houses: MapHouse[]): HouseFeature[] {
  return houses
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lng) && !(h.lat === 0 && h.lng === 0))
    .map((h) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [h.lng, h.lat] },
      properties: {
        id: h.id,
        address: h.address,
        stage: h.stage,
        color: STAGE_COLOR[h.stage],
        contacts: h.contacts.join(", "),
        customerId: h.customerId,
      },
    }));
}

/** The four numbers a viewport is, checked, or nothing. */
export function parseBbox(params: URLSearchParams): { minLat: number; minLng: number; maxLat: number; maxLng: number } | null {
  const read = (key: string) => {
    const value = Number(params.get(key));
    return Number.isFinite(value) ? value : null;
  };
  const minLat = read("minLat");
  const minLng = read("minLng");
  const maxLat = read("maxLat");
  const maxLng = read("maxLng");
  if (minLat == null || minLng == null || maxLat == null || maxLng == null) return null;
  if (minLat > maxLat || minLng > maxLng) return null;
  if (Math.abs(minLat) > 90 || Math.abs(maxLat) > 90 || Math.abs(minLng) > 180 || Math.abs(maxLng) > 180) return null;
  return { minLat, minLng, maxLat, maxLng };
}

/**
 * Whether a viewport is small enough to be worth filling with every house.
 *
 * Below this zoom a screen of Harford County would be tens of thousands of
 * dots saying only "there are houses here", which the satellite photo already
 * says. Zoomed in past it, the dots are doors.
 */
export const ALL_ADDRESSES_MIN_ZOOM = 13;

/** `[lng, lat, stageRank]`, as the all-houses route sends it. */
export type MapPoint = [number, number, number];

export interface PointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: { s: number };
}

/** Every point as a feature, carrying only its stage rank; the layer colours by that. */
export function pointsToFeatures(points: MapPoint[]): PointFeature[] {
  const out: PointFeature[] = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length < 3) continue;
    const [lng, lat, s] = point;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    out.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: { s: Number(s) || 0 } });
  }
  return out;
}

/** The Mapbox `match` expression that turns a stage rank into its colour. */
export function stageColorExpression(): unknown[] {
  const cases: unknown[] = [];
  RELATIONSHIP_STAGES.forEach((stage, rank) => {
    cases.push(rank, STAGE_COLOR[stage]);
  });
  return ["match", ["get", "s"], ...cases, STAGE_COLOR.untouched];
}

/**
 * The stage a house shows on the map.
 *
 * The event log's high-water mark, except that a house with somebody
 * attached and nothing yet recorded counts as spoken to: we know who lives
 * there, and "have we talked to them" is the map's question.
 */
export function stageForMap(events: HouseEvent[], hasContacts: boolean): RelationshipStage {
  const stage = displayStage(events);
  return stage === "untouched" && hasContacts ? "spoken_to" : stage;
}

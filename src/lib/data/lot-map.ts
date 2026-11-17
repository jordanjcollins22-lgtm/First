import { createAdminClient } from "@/lib/supabase/admin";
import { centroidOf, parseParcel, pickFootprint, pickFront, pointInRing, ringsOf, roadLines, streetOf, type LngLat, type LotData } from "@/lib/lot-map";
import { ringSqft, yardAround } from "@/lib/yard-shape";

/**
 * Harford County's own map services: the property lines, the building
 * outlines and the road centerlines with their address ranges.
 */
const COUNTY = "https://hcggis.harfordcountymd.gov/arcgis/rest/services";
const PARCELS = `${COUNTY}/County_Data/Cadastral/MapServer/0/query`;
const FOOTPRINTS = `${COUNTY}/WebGIS/Base_Mapping_EXB/MapServer/89/query`;
const CENTERLINES = `${COUNTY}/WebGIS/Base_Mapping_EXB/MapServer/73/query`;

/** Asked again after this when the county had nothing, not on every open. */
const RETRY_EMPTY_MS = 24 * 60 * 60 * 1000;

async function countyQuery(layer: string, geometry: string, geometryType: "esriGeometryPoint" | "esriGeometryEnvelope", fields = "*"): Promise<unknown> {
  const url = new URL(layer);
  url.searchParams.set("f", "json");
  url.searchParams.set("geometry", geometry);
  url.searchParams.set("geometryType", geometryType);
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", fields);
  url.searchParams.set("returnGeometry", "true");
  const response = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
  if (!response.ok) throw new Error(`County map service answered ${response.status}`);
  return response.json();
}

function envelope(ring: LngLat[], padMetres: number): string {
  const lat = ring[0][1];
  const dLng = padMetres / (Math.cos((lat * Math.PI) / 180) * 111320);
  const dLat = padMetres / 110574;
  const lngs = ring.map((p) => p[0]);
  const lats = ring.map((p) => p[1]);
  return [Math.min(...lngs) - dLng, Math.min(...lats) - dLat, Math.max(...lngs) + dLng, Math.max(...lats) + dLat].join(",");
}

/** A box this many metres round a point, for the county's envelope queries. */
function boxAround([lng, lat]: LngLat, padMetres: number): string {
  const dLng = padMetres / (Math.cos((lat * Math.PI) / 180) * 111320);
  const dLat = padMetres / 110574;
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(",");
}

/** Bumped whenever the way a lot is worked out changes, so stored copies are worked out again. */
export const LOT_VERSION = 4;

/** Everything the lot picture needs, straight from the county. Null when the address is not on a Harford parcel. */
export async function fetchLotFromCounty(lat: number, lng: number, address: string): Promise<LotData | null> {
  const parcel = parseParcel(await countyQuery(PARCELS, `${lng},${lat}`, "esriGeometryPoint", "Shape_Acre,ST_SQ_FT,P_ST_NO,LANDUSE"));
  if (!parcel) return null;
  const pin: LngLat = [lng, lat];
  const [footprints, nearby, roads] = await Promise.all([
    countyQuery(FOOTPRINTS, envelope(parcel.ring, 5), "esriGeometryEnvelope", "OBJECTID").catch(() => null),
    countyQuery(FOOTPRINTS, boxAround(pin, YARD_SEARCH_M), "esriGeometryEnvelope", "OBJECTID").catch(() => null),
    countyQuery(CENTERLINES, envelope(parcel.ring, 200), "esriGeometryEnvelope", "NAME,STREETNAME,FR_ADD_L,TO_ADD_L,FR_ADD_R,TO_ADD_R").catch(() => null),
  ]);
  const near = nearbyBuildings(nearby);
  let footprint = footprints ? pickFootprint(footprints, pin, parcel.ring) : null;

  // Where the county has no line round this home's yard, draw one.
  let ring = parcel.ring;
  let lotSqft = parcel.lotSqft;
  let yardDrawn = false;
  const kind = yardKind(parcel, footprint, near);
  if (kind === "house-only") {
    // The county's lot is this home exactly, so it is the home. Its
    // neighbours are the other homes' lots; the yard is on the common land.
    const parcels = await countyQuery(PARCELS, boxAround(pin, YARD_SEARCH_M), "esriGeometryEnvelope", "P_ST_NO").catch(() => null);
    const all = parcels ? ringsOf(parcels) : [];
    const middle = centroidOf(parcel.ring);
    const isHome = (p: { attributes: Record<string, unknown> }) => typeof p.attributes.P_ST_NO === "number" && p.attributes.P_ST_NO > 0;
    const homes = all.filter((p) => isHome(p) && !pointInRing(middle, p.ring)).map((p) => p.ring);
    const common = all.filter((p) => !isHome(p)).flatMap((p) => p.parts);
    const yard = yardAround({
      pin,
      home: parcel.ring,
      splitRow: false,
      // Buildings that aren't this home's row: the row itself is covered by the other homes' lots.
      neighbours: [...homes, ...near.filter((r) => !pointInRing(middle, r))],
      allowed: [parcel.ring, ...common],
      front: roads ? pickFront(roads, middle, streetOf(address))?.point ?? null : null,
      streets: roadLines(roads),
    });
    if (yard) {
      ring = yard;
      lotSqft = Math.round(ringSqft(yard));
      yardDrawn = true;
      footprint = parcel.ring;
    }
  } else if (kind === "shared") {
    // One lot for the whole community: the yard is this home's share of it.
    const building = nearestBuilding(near, pin) ?? footprint;
    if (building) {
      const yard = yardAround({
        pin,
        home: building,
        neighbours: near.filter((r) => r !== building),
        allowed: [parcel.ring],
        front: roads ? pickFront(roads, centroidOf(building), streetOf(address))?.point ?? null : null,
        streets: roadLines(roads),
      });
      if (yard) {
        ring = yard;
        lotSqft = Math.round(ringSqft(yard));
        yardDrawn = true;
        footprint = building;
      }
    }
  }

  const house = footprint ? centroidOf(footprint) : pin;
  const front = roads ? pickFront(roads, house, streetOf(address)) : null;
  return {
    ring,
    footprint,
    front: front?.point ?? null,
    frontRoad: front?.road ?? null,
    lotSqft: lotSqft ? Math.round(lotSqft) : null,
    structureSqft: parcel.structureSqft,
    ...(yardDrawn ? { yardDrawn: true } : {}),
    v: LOT_VERSION,
  };
}

/** How far round the pin to look for neighbouring homes and common land. */
const YARD_SEARCH_M = 45;

/** Buildings big enough to be homes: sheds and garages left out. */
function nearbyBuildings(body: unknown): LngLat[][] {
  return ringsOf(body).map((f) => f.ring).filter((r) => ringSqft(r) >= 400);
}

function nearestBuilding(buildings: LngLat[][], pin: LngLat): LngLat[] | null {
  const under = buildings.find((r) => pointInRing(pin, r));
  if (under) return under;
  const kx = Math.cos((pin[1] * Math.PI) / 180) * 111320;
  const metres = (p: LngLat) => Math.hypot((p[0] - pin[0]) * kx, (p[1] - pin[1]) * 110574);
  const sorted = [...buildings].sort((a, b) => metres(centroidOf(a)) - metres(centroidOf(b)));
  return sorted[0] && metres(centroidOf(sorted[0])) < 30 ? sorted[0] : null;
}

/**
 * Whether the county's lot is no good as the yard, and why:
 *  - "house-only": the lot is the house itself (townhouses and condos, where
 *    the grass round it is common land).
 *  - "shared": the lot holds a whole community of homes (a rental community
 *    on one lot, with no street number of its own, or apartments).
 */
export function yardKind(
  parcel: { lotSqft: number | null; streetNumber: number | null; landUse: string | null; ring: LngLat[] },
  footprint: LngLat[] | null,
  near: LngLat[][]
): "house-only" | "shared" | null {
  const lot = parcel.lotSqft ?? ringSqft(parcel.ring);
  if (lot < 3000 || (footprint && lot < ringSqft(footprint) * 1.6)) return "house-only";
  const homesOnLot = near.filter((r) => pointInRing(centroidOf(r), parcel.ring)).length;
  const community = parcel.streetNumber === 0 || parcel.landUse === "M";
  if (community && homesOnLot >= 2) return "shared";
  return null;
}

/**
 * The lot for a property, from the county the first time and from our own
 * copy after. Never throws: a form with no picture still works.
 */
export async function lotForProperty(propertyId: string): Promise<LotData | null> {
  try {
    const admin = createAdminClient();
    const { data: property } = await admin
      .from("properties")
      .select("id, address, lat, lng, parcel, parcel_fetched_at")
      .eq("id", propertyId)
      .maybeSingle();
    if (!property || property.lat == null || property.lng == null) return null;
    const stored = property.parcel as unknown as LotData | null;
    // Kept unless it was worked out the old way: then asked again, and kept if the county is down.
    if (stored && stored.v === LOT_VERSION) return stored;
    if (!stored && property.parcel_fetched_at && Date.now() - new Date(property.parcel_fetched_at).getTime() < RETRY_EMPTY_MS) return null;

    const lot = await fetchLotFromCounty(property.lat, property.lng, property.address ?? "").catch(() => null);
    if (!lot && stored) return stored;
    await admin
      .from("properties")
      .update({ parcel: (lot ?? null) as never, parcel_fetched_at: new Date().toISOString() })
      .eq("id", propertyId);
    return lot;
  } catch (err) {
    console.error("[lot-map] county lot not loaded:", propertyId, err);
    return null;
  }
}

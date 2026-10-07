import { createAdminClient } from "@/lib/supabase/admin";
import { centroidOf, parseParcel, pickFootprint, pickFront, streetOf, type LngLat, type LotData } from "@/lib/lot-map";

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

/** Everything the lot picture needs, straight from the county. Null when the address is not on a Harford parcel. */
export async function fetchLotFromCounty(lat: number, lng: number, address: string): Promise<LotData | null> {
  const parcel = parseParcel(await countyQuery(PARCELS, `${lng},${lat}`, "esriGeometryPoint", "Shape_Acre,ST_SQ_FT"));
  if (!parcel) return null;
  const [footprints, roads] = await Promise.all([
    countyQuery(FOOTPRINTS, envelope(parcel.ring, 5), "esriGeometryEnvelope", "OBJECTID").catch(() => null),
    countyQuery(CENTERLINES, envelope(parcel.ring, 200), "esriGeometryEnvelope", "NAME,STREETNAME,FR_ADD_L,TO_ADD_L,FR_ADD_R,TO_ADD_R").catch(() => null),
  ]);
  const pin: LngLat = [lng, lat];
  const footprint = footprints ? pickFootprint(footprints, pin, parcel.ring) : null;
  const house = footprint ? centroidOf(footprint) : pin;
  const front = roads ? pickFront(roads, house, streetOf(address)) : null;
  return {
    ring: parcel.ring,
    footprint,
    front: front?.point ?? null,
    frontRoad: front?.road ?? null,
    lotSqft: parcel.lotSqft ? Math.round(parcel.lotSqft) : null,
    structureSqft: parcel.structureSqft,
  };
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
    if (property.parcel) return property.parcel as unknown as LotData;
    if (property.parcel_fetched_at && Date.now() - new Date(property.parcel_fetched_at).getTime() < RETRY_EMPTY_MS) return null;

    const lot = await fetchLotFromCounty(property.lat, property.lng, property.address ?? "");
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

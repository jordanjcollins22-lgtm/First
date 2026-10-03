import { env } from "@/lib/env";
import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { EstimateTravelInput } from "@/lib/job-estimate";

type Db = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;
type Point = { lat: number; lng: number };

/** Driving minutes between two points, or null when the map service cannot say. */
async function driveMinutes(from: Point, to: Point): Promise<number | null> {
  if (!env.mapboxToken) return null;
  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  try {
    const res = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?overview=false&access_token=${env.mapboxToken}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { routes?: { duration?: number }[] };
    const seconds = body.routes?.[0]?.duration;
    return typeof seconds === "number" ? Math.round(seconds / 60) : null;
  } catch {
    return null;
  }
}

/**
 * How far the job is from the shop, and what picking up the materials adds.
 *
 * The shop is the business location called "shop" on the map (the first
 * location if none is). The supplier is the one whose name says pickup,
 * supplier or Lehnhoff's; what it adds is the morning drive by way of the
 * supplier, less the drive straight there. Anything that cannot be worked
 * out comes back null and is assumed, and said, by the estimate.
 */
export async function travelForProperty(supabase: Db, organizationId: string, property: Point | null): Promise<EstimateTravelInput> {
  const notes: string[] = [];
  const { data: places } = await supabase.from("business_locations").select("name, lat, lng").eq("organization_id", organizationId);
  const located = (places ?? []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  const shop = located.find((p) => /shop/i.test(p.name)) ?? located.find((p) => !/pickup|supplier|lehnhoff/i.test(p.name)) ?? null;
  const supplier = located.find((p) => /pickup|supplier|lehnhoff/i.test(p.name)) ?? null;

  if (!property || !Number.isFinite(property.lat) || !Number.isFinite(property.lng)) {
    notes.push("The property has no map position, so drive time could not be worked out.");
    return { toSiteMinutes: null, fromSiteMinutes: null, pickupExtraMinutes: null, from: shop?.name ?? null, pickupFrom: supplier?.name ?? null, notes };
  }
  if (!shop) {
    notes.push("No shop is set on the map, so drive time could not be worked out.");
    return { toSiteMinutes: null, fromSiteMinutes: null, pickupExtraMinutes: null, from: null, pickupFrom: supplier?.name ?? null, notes };
  }

  const [toSite, fromSite, toSupplier, supplierToSite] = await Promise.all([
    driveMinutes(shop, property),
    driveMinutes(property, shop),
    supplier ? driveMinutes(shop, supplier) : Promise.resolve(null),
    supplier ? driveMinutes(supplier, property) : Promise.resolve(null),
  ]);
  if (!supplier) notes.push("No supplier is set on the map for material pickup.");
  const pickupExtra =
    toSite != null && toSupplier != null && supplierToSite != null ? Math.max(0, toSupplier + supplierToSite - toSite) : null;
  return { toSiteMinutes: toSite, fromSiteMinutes: fromSite, pickupExtraMinutes: pickupExtra, from: shop.name, pickupFrom: supplier?.name ?? null, notes };
}

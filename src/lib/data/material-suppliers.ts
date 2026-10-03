import type { SupabaseClient } from "@supabase/supabase-js";

import { lookupAddress } from "@/lib/mapbox-geocoding";
import { SUPPLIER_KINDS, type DeliveryFee, type Supplier, type SupplierKind } from "@/lib/material-suppliers";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

export interface StoredSuppliers {
  suppliers: Supplier[];
  /** False until database update 0339 is applied: there is nowhere to keep them yet. */
  available: boolean;
}

const missingTable = (error: { code?: string; message?: string }) =>
  error.code === "42P01" || error.code === "PGRST205" || /material_suppliers|supplier_products/.test(error.message ?? "");

function readFees(raw: unknown): DeliveryFee[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((f) => {
    const o = (f ?? {}) as Record<string, unknown>;
    const fee = Math.round(Number(o.fee_cents));
    const zips = Array.isArray(o.zips) ? o.zips.map(String).filter((z) => /^\d{5}$/.test(z)) : [];
    return Number.isFinite(fee) && fee >= 0 && zips.length > 0 ? [{ town: String(o.town ?? zips[0]), zips, feeCents: fee }] : [];
  });
}

/**
 * The business's bulk suppliers and what they sell. One with an address but
 * no position yet is placed on the map from its address and kept, so it is
 * looked up once. Empty, and not available, until update 0339 is applied.
 */
export async function getMaterialSuppliers(supabase: SupabaseClient<Database>, organizationId: string, options: { includeInactive?: boolean } = {}): Promise<StoredSuppliers> {
  let query = supabase.from("material_suppliers").select("*").eq("organization_id", organizationId).order("name");
  if (!options.includeInactive) query = query.eq("active", true);
  const [{ data: rows, error }, { data: products, error: productError }] = await Promise.all([
    query,
    supabase.from("supplier_products").select("*").eq("organization_id", organizationId).order("sort"),
  ]);
  const failed = error ?? productError;
  if (failed) {
    if (!missingTable(failed)) console.error("[material-suppliers] read failed:", failed.message);
    return { suppliers: [], available: !missingTable(failed) };
  }

  // Place any supplier not on the map yet, once.
  const unplaced = (rows ?? []).filter((r) => (r.lat == null || r.lng == null) && r.address?.trim());
  if (unplaced.length > 0) {
    const admin = createAdminClient();
    await Promise.all(
      unplaced.map(async (r) => {
        const found = await lookupAddress(r.address!, undefined, { autocomplete: false }).catch(() => null);
        const top = found?.ok ? found.suggestions[0] : null;
        if (!top) return;
        r.lat = top.lat;
        r.lng = top.lng;
        await admin.from("material_suppliers").update({ lat: top.lat, lng: top.lng }).eq("id", r.id);
      })
    );
  }

  return {
    available: true,
    suppliers: (rows ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      lat: r.lat,
      lng: r.lng,
      phone: r.phone,
      website: r.website,
      delivers: r.delivers,
      deliveryMinimum: r.delivery_minimum != null ? Number(r.delivery_minimum) : null,
      deliveryFees: readFees(r.delivery_fees),
      deliveryNote: r.delivery_note,
      notes: r.notes,
      sourceUrl: r.source_url,
      checkedOn: r.checked_on,
      active: r.active,
      products: (products ?? [])
        .filter((p) => p.supplier_id === r.id && (options.includeInactive || p.active))
        .map((p) => ({
          id: p.id,
          kind: ((SUPPLIER_KINDS as readonly string[]).includes(p.kind) ? p.kind : "other") as SupplierKind,
          name: p.name,
          unit: p.unit === "ton" ? ("ton" as const) : ("yd" as const),
          priceCents: p.price_cents,
          deliveredPriceCents: p.delivered_price_cents,
          imageUrl: p.image_url,
          productUrl: p.product_url,
          checkedOn: p.checked_on,
        })),
    })),
  };
}

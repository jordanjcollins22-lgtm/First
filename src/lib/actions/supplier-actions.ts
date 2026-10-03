"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/data/team";
import { refuseInDemo } from "@/lib/demo-mode";
import { readSupplier } from "@/lib/material-suppliers";
import { isOwnerLevel } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

type Result = { ok: true; id: string } | { ok: false; error: string };

/**
 * Saves a bulk supplier and everything it sells, as the Suppliers page has
 * it: products left off are removed. A changed address is placed on the map
 * again the next time the suppliers are read. Owners and admins only.
 */
export async function saveSupplier(input: unknown): Promise<Result> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) return { ok: false, error: "Only an owner or admin can change suppliers." };
  const read = readSupplier(input);
  if (!read.ok) return read;
  const s = read.supplier;
  const org = profile.organization_id;
  const db = createAdminClient();
  const now = new Date().toISOString();

  let moved = true;
  if (s.id) {
    const { data: before } = await db.from("material_suppliers").select("address").eq("id", s.id).eq("organization_id", org).maybeSingle();
    if (!before) return { ok: false, error: "That supplier isn't there any more. Reload the page." };
    moved = (before.address ?? "") !== (s.address ?? "");
  }
  const row = {
    organization_id: org,
    name: s.name,
    address: s.address,
    phone: s.phone,
    website: s.website,
    delivers: s.delivers,
    delivery_minimum: s.deliveryMinimum,
    delivery_fees: s.deliveryFees.map((f) => ({ town: f.town, zips: f.zips, fee_cents: f.feeCents })),
    delivery_note: s.deliveryNote,
    notes: s.notes,
    source_url: s.sourceUrl,
    checked_on: s.checkedOn,
    active: s.active,
    updated_at: now,
    ...(moved ? { lat: null, lng: null } : {}),
  };
  const saved = s.id
    ? await db.from("material_suppliers").update(row).eq("id", s.id).eq("organization_id", org).select("id").single()
    : await db.from("material_suppliers").insert(row).select("id").single();
  if (saved.error || !saved.data) {
    console.error("[suppliers] save failed:", saved.error?.message);
    return { ok: false, error: /material_suppliers/.test(saved.error?.message ?? "") ? "This can't be saved until database update 0339 is applied." : "Couldn't save that. Try again." };
  }
  const id = saved.data.id;

  // Only this supplier's own products are updated by id; any other id is a new product.
  const { data: existing } = await db.from("supplier_products").select("id").eq("supplier_id", id).eq("organization_id", org);
  const ours = new Set((existing ?? []).map((p) => p.id));
  const keep = s.products.flatMap((p) => (p.id && ours.has(p.id) ? [p.id] : []));
  const gone = [...ours].filter((pid) => !keep.includes(pid));
  if (gone.length > 0) await db.from("supplier_products").delete().in("id", gone).eq("organization_id", org);
  const products = s.products.map((p, i) => ({
    ...(p.id && ours.has(p.id) ? { id: p.id } : {}),
    organization_id: org,
    supplier_id: id,
    kind: p.kind,
    name: p.name,
    unit: p.unit,
    price_cents: p.priceCents,
    delivered_price_cents: p.deliveredPriceCents,
    image_url: p.imageUrl,
    product_url: p.productUrl,
    checked_on: p.checkedOn ?? s.checkedOn,
    sort: i,
    updated_at: now,
  }));
  const withId = products.filter((p) => "id" in p);
  const fresh = products.filter((p) => !("id" in p));
  const errors = [
    withId.length > 0 ? (await db.from("supplier_products").upsert(withId)).error : null,
    fresh.length > 0 ? (await db.from("supplier_products").insert(fresh)).error : null,
  ].filter(Boolean);
  if (errors.length > 0) {
    console.error("[suppliers] products save failed:", errors[0]!.message);
    return { ok: false, error: "The supplier saved, but its products didn't. Try again." };
  }
  revalidatePath("/admin/suppliers");
  revalidatePath("/my-day");
  return { ok: true, id };
}

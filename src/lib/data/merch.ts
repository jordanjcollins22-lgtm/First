import { createClient } from "@/lib/supabase/server";
import type { MerchOrder, MerchProduct, TeamMember } from "@/types/domain";

export type MerchOrderWithRelations = Omit<MerchOrder, "print_svg"> & {
  product: Pick<MerchProduct, "id" | "name" | "vendor_name" | "vendor_sku" | "print_specs"> | null;
  team_member: Pick<TeamMember, "id" | "name" | "phone"> | null;
};

export async function listMerchProducts({ includeInactive = false } = {}): Promise<MerchProduct[]> {
  const supabase = await createClient();
  let query = supabase.from("merch_products").select("*").order("name");
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as MerchProduct[];
}

export async function getMerchProduct(id: string): Promise<MerchProduct | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("merch_products").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as unknown as MerchProduct | null;
}

export async function listMerchOrders(limit = 200): Promise<MerchOrderWithRelations[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("merch_orders")
    .select(
      "id, product_id, team_member_id, quantity, barcode_value, field_values, ship_to, unit_price_cents, status, payment_status, vendor_order_ref, tracking_number, notes, created_at, updated_at, " +
        "product:merch_products(id, name, vendor_name, vendor_sku, print_specs), team_member:team_members(id, name, phone)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as MerchOrderWithRelations[];
}

export async function listActiveTeamMemberOptions(): Promise<Pick<TeamMember, "id" | "name">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_members")
    .select("id, name")
    .eq("active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}

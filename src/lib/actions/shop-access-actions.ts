"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { canRunJobs } from "@/lib/roles";

export type ShopAccessResult = { ok: true } | { ok: false; message: string };

/** When the crew is due at the shop, and the codes that get them in. */
export async function saveShopAccess(input: { arriveBy: string; accessCodes: string }): Promise<ShopAccessResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!canRunJobs(profile.roles)) return { ok: false, message: "Only somebody who runs jobs can change this." };
  if (!/^\d{1,2}:\d{2}$/.test(input.arriveBy)) return { ok: false, message: "Pick a time." };

  const supabase = await createClient();
  const { error: timeError } = await supabase.from("organizations").update({ shop_arrival_time: input.arriveBy }).eq("id", profile.organization_id);
  if (timeError) return { ok: false, message: "Couldn't save the time." };

  const { data: places } = await supabase.from("business_locations").select("id, name");
  const shop = (places ?? []).find((p) => /shop/i.test(p.name)) ?? (places ?? [])[0] ?? null;
  if (!shop) return { ok: false, message: "Saved the time. Add the shop as a location to keep its codes." };
  const { error } = await supabase.from("business_locations").update({ access_codes: input.accessCodes.trim().slice(0, 300) || null }).eq("id", shop.id);
  if (error) return { ok: false, message: "Couldn't save the codes." };

  revalidatePath("/admin/tools/kits");
  revalidatePath("/my-day");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles } from "@/lib/permissions";

/** Marks a paid mow as called, so it comes off the top of the list. Under the caller's own sign-in. */
export async function markMowCalled(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  const permissions = await listRolePermissions().catch(() => []);
  if (!tabsAllowedForRoles(profile.roles, permissions).has("mow-orders")) return { ok: false, message: "Only someone with Quick Mows can do that." };
  const supabase = await createClient();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("mow_orders")
    .update({ called_at: now, called_by: profile.id, updated_at: now })
    .eq("id", id)
    .eq("status", "paid")
    .is("called_at", null);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  revalidatePath("/mow-orders");
  revalidatePath("/sales");
  return { ok: true };
}

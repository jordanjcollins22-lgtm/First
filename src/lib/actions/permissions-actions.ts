"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";

export async function setRolePermission(role: string, tab: string, allowed: boolean) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can edit permissions.");
  }

  const supabase = await createClient();
  if (allowed) {
    const { error } = await supabase.from("role_permissions").insert({ role_name: role, tab_key: tab });
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await supabase.from("role_permissions").delete().eq("role_name", role).eq("tab_key", tab);
    if (error) throw error;
  }
  revalidatePath("/", "layout");
}

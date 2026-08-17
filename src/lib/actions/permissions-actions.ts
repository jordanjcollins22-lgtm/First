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

/**
 * Grants or revokes one page for every role at once.
 *
 * Revoking clears every role's grant, which leaves the page with no rows at
 * all — the same state a brand-new page is in. That's deliberate: it means
 * "nobody has decided", so the page falls back to the default declared beside
 * it rather than becoming unreachable even for the admin who just unticked it.
 * To genuinely restrict a page, tick the roles that should have it instead.
 */
export async function setTabOpenToAll(tab: string, open: boolean) {
  const caller = await getCurrentProfile();
  if (!caller?.roles.includes("admin")) {
    throw new Error("Only admins can edit permissions.");
  }

  const supabase = await createClient();

  if (open) {
    const { data: roles, error: rolesError } = await supabase.from("roles").select("name");
    if (rolesError) throw rolesError;

    const rows = (roles ?? []).map((r) => ({ role_name: r.name as string, tab_key: tab }));
    if (rows.length > 0) {
      const { error } = await supabase.from("role_permissions").upsert(rows, {
        onConflict: "role_name,tab_key",
        ignoreDuplicates: true,
      });
      if (error) throw error;
    }
  } else {
    const { error } = await supabase.from("role_permissions").delete().eq("tab_key", tab);
    if (error) throw error;
  }

  revalidatePath("/", "layout");
}

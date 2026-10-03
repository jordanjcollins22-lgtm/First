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
    const { error } = await supabase
      .from("role_permissions")
      .upsert({ role_name: role, tab_key: tab, granted: true }, { onConflict: "role_name,tab_key" });
    if (error) throw error;
  } else if (role === "admin") {
    // Written down rather than deleted. For an admin, no row means "nobody has
    // decided", which grants the page -- so unticking has to say no out loud
    // or it does nothing at all.
    const { error } = await supabase
      .from("role_permissions")
      .upsert({ role_name: role, tab_key: tab, granted: false }, { onConflict: "role_name,tab_key" });
    if (error) throw error;
  } else {
    // Every other role is denied by having no row, so removing it is the deny.
    const { error } = await supabase.from("role_permissions").delete().eq("role_name", role).eq("tab_key", tab);
    if (error) throw error;
  }

  revalidatePath("/", "layout");
}

/**
 * Grants or revokes one page for every role at once.
 *
 * Revoking clears every role's grant, which leaves the page with no rows at
 * all — the same state a brand-new page is in, meaning nobody has decided. An
 * admin keeps it either way, because an admin who cannot reach a page has no
 * way to grant it back. To genuinely restrict a page, tick the roles that
 * should have it instead.
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

    const rows = (roles ?? []).map((r) => ({
      role_name: r.name as string,
      tab_key: tab,
      granted: true,
    }));
    if (rows.length > 0) {
      const { error } = await supabase
        .from("role_permissions")
        .upsert(rows, { onConflict: "role_name,tab_key" });
      if (error) throw error;
    }
  } else {
    // Clears every role's grant, which is the same state a brand-new page is
    // in: nobody has decided. An admin keeps it, because an admin who cannot
    // reach a page has no way to grant it back.
    const { error } = await supabase.from("role_permissions").delete().eq("tab_key", tab);
    if (error) throw error;
  }

  revalidatePath("/", "layout");
}

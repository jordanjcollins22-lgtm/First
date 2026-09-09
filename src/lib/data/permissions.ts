import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import type { RolePermission } from "@/types/domain";

/**
 * The whole permissions matrix, read once per request.
 *
 * Twenty-five rows, and every gate on every page asks for them. Cheap on its
 * own; a round trip a time when the nav, the page and three panels each check
 * what somebody is allowed.
 */
export const listRolePermissions = cache(async function listRolePermissions(): Promise<RolePermission[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("role_permissions").select("*");
  if (error) throw error;
  return (data ?? []) as unknown as RolePermission[];
});

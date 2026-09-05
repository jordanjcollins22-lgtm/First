import { createClient } from "@/lib/supabase/server";
import type { RolePermission } from "@/types/domain";

export async function listRolePermissions(): Promise<RolePermission[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("role_permissions").select("*");
  if (error) throw error;
  return (data ?? []) as unknown as RolePermission[];
}

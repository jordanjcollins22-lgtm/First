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

export interface RoleEdit {
  id: number;
  at: string;
  role: string;
  action: "created" | "renamed" | "deleted" | "permission_granted" | "permission_removed" | "person_added" | "person_removed";
  /** The page, the person, or the old name. */
  subject: string | null;
  /** Who made the change; null when the database itself did. */
  by: string | null;
}

/**
 * Every change to a role, newest first: created, renamed, deleted, a page
 * given or taken away, a person added or removed. Written by the database
 * whatever made the change (migration 0333), so it cannot miss one. Admins
 * only.
 */
export async function listRoleEdits(limit = 500): Promise<RoleEdit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("role_edit_log" as never)
    .select("id, at, role_name, action, subject, actor_name")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as unknown as { id: number; at: string; role_name: string; action: RoleEdit["action"]; subject: string | null; actor_name: string | null }[]).map((r) => ({
    id: r.id,
    at: r.at,
    role: r.role_name,
    action: r.action,
    subject: r.subject,
    by: r.actor_name,
  }));
}

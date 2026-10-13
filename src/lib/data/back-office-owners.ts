import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTeamMember } from "@/lib/notifications";
import { TOOLS_OWNER_EMAILS } from "@/lib/tool-editors";

/**
 * Who "the owner" is, for a back-office alert.
 *
 * The owner's own sign-ins first, as the hiring alerts do. A business
 * without those (another organisation on the same app) falls back to
 * everybody owner-level, so an alert never goes to nobody.
 */
export async function ownerIds(organizationId: string): Promise<string[]> {
  const admin = createAdminClient() as unknown as SupabaseClient;
  const { data: named } = await admin.from("profiles").select("id").eq("organization_id", organizationId).in("email", TOOLS_OWNER_EMAILS);
  if ((named ?? []).length > 0) return (named as { id: string }[]).map((p) => p.id);
  const { data: profiles } = await admin.from("profiles").select("id").eq("organization_id", organizationId);
  const ids = ((profiles ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length === 0) return [];
  const { data: roles } = await admin.from("profile_roles").select("profile_id, role_name").in("profile_id", ids);
  return [
    ...new Set(
      ((roles ?? []) as { profile_id: string; role_name: string }[])
        .filter((r) => ["admin", "owner"].includes(r.role_name.toLowerCase().trim()))
        .map((r) => r.profile_id)
    ),
  ];
}

/**
 * Tell the owner, once per key. The key is claimed in notification_log
 * before the send, so a cron running twice says it once.
 */
export async function tellOwner(organizationId: string, body: string, dedupeKey: string): Promise<number> {
  const ids = await ownerIds(organizationId);
  const sent = await Promise.all(
    ids.map((id) => notifyTeamMember(id, "compliance_alert", body, { dedupeKey, overridesKindPreference: true }).catch(() => false))
  );
  return sent.filter(Boolean).length;
}

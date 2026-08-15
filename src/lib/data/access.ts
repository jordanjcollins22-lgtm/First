import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles, type TabKey } from "@/lib/permissions";
import type { Profile } from "@/types/domain";

// Admins are NOT auto-granted every tab here — the Permissions page lets an
// admin uncheck their own tabs to see what a restricted view looks like.
// The safety net against locking yourself out lives in the Permissions page
// itself (/admin/permissions), which is gated on the "admin" role directly
// rather than on this tabs table, and its nav link is never tab-gated — so
// there's always a way back in no matter what's unchecked here.
async function resolveTabAccess(tab: TabKey): Promise<{ allowed: boolean; profile: Profile | null }> {
  const profile = await getCurrentProfile();
  if (!profile) return { allowed: false, profile: null };

  const permissions = await listRolePermissions().catch(() => []);
  return { allowed: tabsAllowedForRoles(profile.roles, permissions).has(tab), profile };
}

/** Soft gate for pages that can't safely redirect (would loop with another gated page) — caller renders inline instead. */
export async function checkTabAccess(tab: TabKey) {
  return resolveTabAccess(tab);
}

/** Hard gate — bounces away entirely if this tab isn't granted. */
export async function requireTab(tab: TabKey, fallback: string) {
  const { allowed } = await resolveTabAccess(tab);
  if (!allowed) redirect(fallback);
}

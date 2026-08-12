import { redirect } from "next/navigation";

import { getCurrentProfile } from "@/lib/data/team";
import { listRolePermissions } from "@/lib/data/permissions";
import { tabsAllowedForRoles, type TabKey } from "@/lib/permissions";
import type { Profile } from "@/types/domain";

async function resolveTabAccess(tab: TabKey): Promise<{ allowed: boolean; profile: Profile | null }> {
  const profile = await getCurrentProfile();
  if (!profile) return { allowed: false, profile: null };
  if (profile.roles.includes("admin")) return { allowed: true, profile };

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

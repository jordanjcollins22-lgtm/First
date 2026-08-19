import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
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

/**
 * Hard gate — bounces away entirely if this tab isn't granted.
 *
 * The destination is told which tab was refused so it can say so. Being
 * silently teleported somewhere else is the worst version of this: the person
 * clicked a link that existed, ended up on a different page, and has no idea
 * whether they misclicked or the app is broken.
 */
export async function requireTab(tab: TabKey, fallback: string) {
  const { allowed } = await resolveTabAccess(tab);
  if (!allowed) redirect(deniedUrl(fallback, tab));
}

/**
 * Gate for a page you can only reach by clicking a row in a list.
 *
 * Granted if its own tab is ticked, or if any list that links to it is. A
 * detail page that refuses somebody who can see the row linking to it is not
 * protecting anything — the name, address and status are already on the screen
 * they came from — it just breaks the link. The explicit tick still works as a
 * standalone grant for anyone who has no list access at all.
 */
export async function requireAnyTab(tabs: TabKey[], fallback: string) {
  const profile = await getCurrentProfile();
  if (!profile) redirect(deniedUrl(fallback, tabs[0]));

  const permissions = await listRolePermissions().catch(() => []);
  const allowed = tabsAllowedForRoles(profile.roles, permissions);
  if (!tabs.some((tab) => allowed.has(tab))) redirect(deniedUrl(fallback, tabs[0]));
}

function deniedUrl(fallback: string, tab: TabKey): string {
  const separator = fallback.includes("?") ? "&" : "?";
  return `${fallback}${separator}denied=${encodeURIComponent(tab)}`;
}

/**
 * Gate for one job's page.
 *
 * Granted by any of the usual tabs, or by being the person assigned to it. A
 * crew member's Today screen links straight to the job they are standing on,
 * and they may hold none of the office tabs — refusing them there would make
 * their own work unreachable from their own screen.
 */
export async function requireJobAccess(jobId: string, tabs: TabKey[]) {
  const profile = await getCurrentProfile();
  if (!profile) redirect(deniedUrl("/attractors", tabs[0]));

  const permissions = await listRolePermissions().catch(() => []);
  if (tabs.some((tab) => tabsAllowedForRoles(profile.roles, permissions).has(tab))) return;

  // Being on the crew counts, not just leading it — every one of them has
  // this job on their Today screen and needs the link to work.
  const supabase = await createClient();
  const [{ data: job }, { data: membership }] = await Promise.all([
    supabase.from("jobs").select("assigned_to").eq("id", jobId).maybeSingle(),
    supabase
      .from("job_crew")
      .select("id")
      .eq("job_id", jobId)
      .eq("profile_id", profile.id)
      .maybeSingle(),
  ]);
  if (job?.assigned_to === profile.id || membership) return;

  redirect(deniedUrl("/attractors", tabs[0]));
}

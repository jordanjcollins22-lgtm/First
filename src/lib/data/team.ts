import { getUserWithRetry } from "@/lib/supabase/auth-guard";
import { createClient } from "@/lib/supabase/server";
import { getViewAsProfileId } from "@/lib/impersonation";
import type { CustomRole, Profile } from "@/types/domain";

export async function listRoles(): Promise<CustomRole[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("roles")
    .select("*")
    .order("is_system", { ascending: false })
    .order("name");

  if (error) throw error;
  return (data ?? []) as unknown as CustomRole[];
}

export async function listProfiles(): Promise<Profile[]> {
  const supabase = await createClient();
  const [{ data: profiles, error: profilesError }, { data: profileRoles, error: rolesError }] = await Promise.all([
    supabase.from("profiles").select("*").order("email"),
    supabase.from("profile_roles").select("*"),
  ]);
  if (profilesError) throw profilesError;
  if (rolesError) throw rolesError;

  const rolesByProfile = new Map<string, string[]>();
  for (const pr of profileRoles ?? []) {
    const list = rolesByProfile.get(pr.profile_id) ?? [];
    list.push(pr.role_name);
    rolesByProfile.set(pr.profile_id, list);
  }

  return (profiles ?? []).map((p) => ({ ...p, roles: rolesByProfile.get(p.id) ?? [] })) as unknown as Profile[];
}

async function fetchProfileById(id: string): Promise<Profile | null> {
  const supabase = await createClient();
  const [{ data: profile, error: profileError }, { data: profileRoles, error: rolesError }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", id).maybeSingle(),
    supabase.from("profile_roles").select("role_name").eq("profile_id", id),
  ]);
  if (profileError) throw profileError;
  if (!profile) return null;
  if (rolesError) throw rolesError;

  return { ...profile, roles: (profileRoles ?? []).map((r) => r.role_name) } as unknown as Profile;
}

/** The actually-signed-in account, ignoring any "view as" switch — use this for
 * anything auth-sensitive (granting/revoking the switch itself, audit trails). */
export async function getRealProfile(): Promise<Profile | null> {
  const supabase = await createClient();

  // Retried once when the check fails for a reason that was not an answer.
  // Without it a single lost request looks like being signed out, and every
  // page that redirects on a null profile throws somebody back to the login
  // screen mid-session. A genuinely expired session still fails twice.
  const { data } = await getUserWithRetry(() => supabase.auth.getUser());
  const user = data.user as { id: string } | null;
  if (!user) return null;
  return fetchProfileById(user.id);
}

/**
 * The profile the app should behave as. Normally the signed-in account, but
 * if an admin has switched into another team member's account (see
 * lib/actions/impersonation-actions.ts), everything reads/writes as that
 * person instead — same tabs, same "my evaluations", same everything —
 * until they switch back. Only ever swaps for admins, and only within their
 * own organization, checked fresh on every call.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const real = await getRealProfile();
  if (!real || !real.roles.includes("admin")) return real;

  const viewAsId = await getViewAsProfileId();
  if (!viewAsId || viewAsId === real.id) return real;

  const target = await fetchProfileById(viewAsId);
  if (!target || target.organization_id !== real.organization_id) return real;
  return target;
}

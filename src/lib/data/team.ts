import { createClient } from "@/lib/supabase/server";
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

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile, error: profileError }, { data: profileRoles, error: rolesError }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("profile_roles").select("role_name").eq("profile_id", user.id),
  ]);
  if (profileError) throw profileError;
  if (!profile) return null;
  if (rolesError) throw rolesError;

  return { ...profile, roles: (profileRoles ?? []).map((r) => r.role_name) } as unknown as Profile;
}

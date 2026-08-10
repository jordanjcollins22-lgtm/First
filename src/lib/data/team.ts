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
  const { data, error } = await supabase.from("profiles").select("*").order("email");

  if (error) throw error;
  return (data ?? []) as unknown as Profile[];
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data as unknown as Profile | null;
}

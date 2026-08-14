import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { Organization } from "@/types/domain";

/** Every server action that inserts org-scoped data needs this. */
export async function getCurrentOrganizationId(): Promise<string> {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  return profile.organization_id;
}

/** Superadmin-only (jordan@jslandscapingmd.com) — RLS restricts everyone else to their own org's row. */
export async function listOrganizations(): Promise<Organization[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("*").order("name");
  if (error) throw error;
  return (data ?? []) as unknown as Organization[];
}

export async function getCurrentOrganization(): Promise<Organization> {
  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { data, error } = await supabase.from("organizations").select("*").eq("id", organizationId).single();
  if (error) throw error;
  return data as unknown as Organization;
}

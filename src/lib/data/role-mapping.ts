import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { findRoleProblems, type MappingFinding, type PersonForMapping } from "@/lib/hr/role-mapping";

/** Everybody in the business with their roles, ready for the role-mapping check. */
export async function loadPeopleForMapping(organizationId: string): Promise<PersonForMapping[]> {
  const sb = createAdminClient() as unknown as SupabaseClient;
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, full_name, email, is_affiliate, does_evaluations, trial_crew, pay_type")
    .eq("organization_id", organizationId);
  const list = (profiles ?? []) as { id: string; full_name: string | null; email: string | null; is_affiliate: boolean | null; does_evaluations: boolean | null; trial_crew: boolean | null; pay_type: string | null }[];
  if (list.length === 0) return [];
  const { data: roles } = await sb.from("profile_roles").select("profile_id, role_name").in("profile_id", list.map((p) => p.id));
  const rolesOf = new Map<string, string[]>();
  for (const r of (roles ?? []) as { profile_id: string; role_name: string }[]) rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role_name]);
  return list.map((p) => ({
    id: p.id,
    name: p.full_name || p.email || "Somebody",
    roles: rolesOf.get(p.id) ?? [],
    isAffiliate: Boolean(p.is_affiliate),
    doesEvaluations: p.does_evaluations,
    trialCrew: Boolean(p.trial_crew),
    payType: p.pay_type,
  }));
}

export async function roleProblems(organizationId: string): Promise<MappingFinding[]> {
  return findRoleProblems(await loadPeopleForMapping(organizationId));
}

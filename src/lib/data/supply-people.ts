import type { SupabaseClient } from "@supabase/supabase-js";

import { notifyTeamMember } from "@/lib/notifications";
import { CANONICAL, LEGACY_ALIASES } from "@/lib/roles";

/**
 * Who hears about materials and equipment.
 *
 * The job's own project lead first: the person whose crew is standing in the
 * garden without mulch. With no lead on the job, the business's project
 * leads; with none of those, the owners. The owner is the last resort here,
 * not the first call, which is the point of the whole redesign.
 */

const LEAD_NAMES = [...CANONICAL["project-lead"], ...(LEGACY_ALIASES["project-lead"] ?? [])];
const OWNER_NAMES = [...CANONICAL.owner, ...(LEGACY_ALIASES.owner ?? [])];

async function orgPeopleWithRoles(admin: SupabaseClient, organizationId: string, names: string[]): Promise<string[]> {
  const { data: people } = await admin.from("profiles").select("id").eq("organization_id", organizationId);
  const ids = ((people ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length === 0) return [];
  const { data: roles } = await admin.from("profile_roles").select("profile_id, role_name").in("profile_id", ids);
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  return [
    ...new Set(
      ((roles ?? []) as { profile_id: string; role_name: string }[])
        .filter((r) => wanted.has(r.role_name.toLowerCase().replace(/[_\s]+/g, " ").trim()))
        .map((r) => r.profile_id)
    ),
  ];
}

/** The business's project leads, or its owners when it has none. */
export async function orgLeads(admin: SupabaseClient, organizationId: string): Promise<string[]> {
  const leads = await orgPeopleWithRoles(admin, organizationId, LEAD_NAMES);
  return leads.length > 0 ? leads : orgPeopleWithRoles(admin, organizationId, OWNER_NAMES);
}

/** The lead on this job, else the business's leads, else its owners. */
export async function leadsForJob(admin: SupabaseClient, organizationId: string, jobId: string): Promise<string[]> {
  const { data } = await admin.from("job_crew").select("profile_id").eq("job_id", jobId).eq("is_lead", true);
  const onJob = ((data ?? []) as { profile_id: string }[]).map((r) => r.profile_id);
  return onJob.length > 0 ? [...new Set(onJob)] : orgLeads(admin, organizationId);
}

/**
 * One alert to each of them, once. Team notifications go by text, or email
 * when there is no text line; the dedupe key stops a second run sending it
 * again. Best effort: a notification failing never fails the run.
 */
export async function tellLeads(profileIds: string[], body: string, dedupeKey: string): Promise<number> {
  const sent = await Promise.all(
    profileIds.map((id) =>
      notifyTeamMember(id, "team_messages", body, { dedupeKey: `${dedupeKey}:${id}`, overridesKindPreference: true }).catch(() => false)
    )
  );
  return sent.filter(Boolean).length;
}

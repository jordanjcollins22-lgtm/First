import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { settingsFromRow, startStamps, type AutopilotSettings, type SettingsRow } from "@/lib/ops/autopilot-settings";

/**
 * The operations autopilot's switches, read and stamped.
 *
 * Read with the service role because the crons have nobody signed in, and
 * because the panel's writes are already gated by an owner check in the
 * action. The tables are newer than the generated types, hence the cast.
 */

export const untyped = (client: unknown) => client as SupabaseClient;

export function admin(): SupabaseClient {
  return untyped(createAdminClient());
}

/**
 * The settings for one business, writing the row (and the start times of any
 * switch that is on) the first time it is read. That first read is the
 * moment the automation went live, so everything older is left alone.
 *
 * Never throws: a missing table (the migration not applied yet) reads as
 * "not ready", and every automation then does nothing.
 */
export async function ensureSettings(organizationId: string, client: SupabaseClient = admin()): Promise<{ settings: AutopilotSettings; ready: boolean }> {
  const { data, error } = await client.from("ops_autopilot_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) return { settings: settingsFromRow(null), ready: false };

  const row = (data ?? { organization_id: organizationId }) as SettingsRow;
  const stamps = startStamps(row, new Date().toISOString());
  if (!data || Object.keys(stamps).length > 0) {
    const merged = { ...row, ...stamps, organization_id: organizationId };
    const { error: writeError } = await client.from("ops_autopilot_settings").upsert(merged, { onConflict: "organization_id" });
    if (writeError) return { settings: settingsFromRow(row), ready: false };
    return { settings: settingsFromRow(merged), ready: true };
  }
  return { settings: settingsFromRow(row), ready: true };
}

/** Read only, for a page. Missing row reads as the defaults. */
export async function readSettings(organizationId: string): Promise<{ settings: AutopilotSettings; ready: boolean }> {
  const { data, error } = await admin().from("ops_autopilot_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) return { settings: settingsFromRow(null), ready: false };
  return { settings: settingsFromRow(data as SettingsRow | null), ready: true };
}

/** Every business, for the crons. */
export async function allOrganizationIds(client: SupabaseClient = admin()): Promise<string[]> {
  const { data } = await client.from("organizations").select("id");
  return ((data ?? []) as { id: string }[]).map((o) => o.id);
}

/**
 * Owner-level people in one business. The check-in alert used to read these
 * across every business, which texted one company's owner about another's
 * crew; this is scoped by the profile's own organization.
 */
export async function ownerIdsFor(organizationId: string, client: SupabaseClient = admin()): Promise<string[]> {
  const { data: people } = await client.from("profiles").select("id").eq("organization_id", organizationId);
  const ids = ((people ?? []) as { id: string }[]).map((p) => p.id);
  if (ids.length === 0) return [];
  const { data: roles } = await client.from("profile_roles").select("profile_id, role_name").in("profile_id", ids).in("role_name", ["owner", "admin"]);
  return [...new Set(((roles ?? []) as { profile_id: string }[]).map((r) => r.profile_id))];
}

/** Jobs reach their business through property → customer. One read for many. */
export async function jobOrganizations(jobIds: string[], client: SupabaseClient = admin()): Promise<Map<string, string>> {
  if (jobIds.length === 0) return new Map();
  const { data } = await client
    .from("jobs")
    .select("id, property:properties!inner(customers!inner(organization_id))")
    .in("id", [...new Set(jobIds)]);
  const out = new Map<string, string>();
  for (const row of (data ?? []) as unknown as { id: string; property: { customers: { organization_id: string } | null } | null }[]) {
    const org = row.property?.customers?.organization_id;
    if (org) out.set(row.id, org);
  }
  return out;
}

/** The lead on each job, from the roster. */
export async function leadsFor(jobIds: string[], client: SupabaseClient = admin()): Promise<Map<string, string>> {
  if (jobIds.length === 0) return new Map();
  const { data } = await client.from("job_crew").select("job_id, profile_id").in("job_id", [...new Set(jobIds)]).eq("is_lead", true);
  return new Map(((data ?? []) as { job_id: string; profile_id: string }[]).map((r) => [r.job_id, r.profile_id]));
}

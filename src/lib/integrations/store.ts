import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reading and writing the integration_credentials table. Server only, with
 * the service role: the table has no policies, so nothing in a browser can
 * read a key. Callers are responsible for checking the person is an owner.
 */

export interface IntegrationRow {
  provider: string;
  secrets: Record<string, string>;
  settings: Record<string, unknown>;
  status: "not_connected" | "connected" | "error";
  connected_at: string | null;
  last_checked_at: string | null;
  last_error: string | null;
  updated_at: string;
}

/** What the page may show: which fields are filled, never their values. */
export type IntegrationSummary = Omit<IntegrationRow, "secrets"> & { filled: string[] };

const db = () => createAdminClient() as unknown as SupabaseClient;

export async function getIntegration(organizationId: string, provider: string): Promise<IntegrationRow | null> {
  const { data, error } = await db()
    .from("integration_credentials")
    .select("provider,secrets,settings,status,connected_at,last_checked_at,last_error,updated_at")
    .eq("organization_id", organizationId)
    .eq("provider", provider)
    .maybeSingle();
  if (error) return null;
  return (data as IntegrationRow | null) ?? null;
}

/** The saved secrets for a provider, or null when it isn't connected. */
export async function credentialsFor(organizationId: string, provider: string): Promise<Record<string, string> | null> {
  const row = await getIntegration(organizationId, provider);
  return row && row.status !== "not_connected" ? row.secrets : null;
}

export async function listIntegrations(organizationId: string): Promise<IntegrationSummary[]> {
  const { data } = await db()
    .from("integration_credentials")
    .select("provider,secrets,settings,status,connected_at,last_checked_at,last_error,updated_at")
    .eq("organization_id", organizationId);
  return ((data ?? []) as IntegrationRow[]).map(({ secrets, ...rest }) => ({
    ...rest,
    filled: Object.entries(secrets ?? {}).filter(([, v]) => typeof v === "string" && v.length > 0).map(([k]) => k),
  }));
}

/**
 * Saves values for a provider. Secrets merge onto what is saved, and an empty
 * string leaves a saved secret alone, so the form never has to send one back.
 */
export async function saveIntegration(
  organizationId: string,
  provider: string,
  patch: {
    secrets?: Record<string, string>;
    settings?: Record<string, unknown>;
    status?: IntegrationRow["status"];
    lastError?: string | null;
    updatedBy?: string | null;
  }
): Promise<void> {
  const current = await getIntegration(organizationId, provider);
  const secrets = { ...(current?.secrets ?? {}) };
  for (const [k, v] of Object.entries(patch.secrets ?? {})) if (v) secrets[k] = v;
  const now = new Date().toISOString();
  const status = patch.status ?? current?.status ?? "not_connected";
  const { error } = await db()
    .from("integration_credentials")
    .upsert({
      organization_id: organizationId,
      provider,
      secrets,
      settings: { ...(current?.settings ?? {}), ...(patch.settings ?? {}) },
      status,
      connected_at: status === "connected" ? (current?.connected_at ?? now) : current?.connected_at ?? null,
      last_checked_at: patch.status ? now : current?.last_checked_at ?? null,
      last_error: patch.lastError === undefined ? current?.last_error ?? null : patch.lastError,
      updated_at: now,
      updated_by: patch.updatedBy ?? null,
    });
  if (error) throw error;
}

export async function disconnectIntegration(organizationId: string, provider: string): Promise<void> {
  await db().from("integration_credentials").delete().eq("organization_id", organizationId).eq("provider", provider);
}

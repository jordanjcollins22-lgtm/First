"use server";

import { revalidatePath } from "next/cache";

import { getRealProfile } from "@/lib/data/team";
import { findProvider, freshenToken } from "@/lib/integrations/catalog";
import { QBO_REVOKE_URL } from "@/lib/integrations/quickbooks/api";
import { disconnectIntegration, getIntegration, saveIntegration } from "@/lib/integrations/store";
import { log } from "@/lib/log";
import { isOwnerLevel } from "@/lib/roles";

/**
 * Save, Test and Disconnect on the Integrations page. Owner only, checked
 * against the account actually signed in (never a "view as" switch), since
 * these are the business's keys.
 */

export type IntegrationResult = { ok: true; message: string } | { ok: false; error: string };

async function owner() {
  const me = await getRealProfile();
  if (!me || !isOwnerLevel(me.roles)) return null;
  return me;
}

const done = () => revalidatePath("/v2/admin");

/**
 * Saves what was typed. Secret fields merge onto what is saved and a blank
 * leaves the saved one alone, so the form never has to hold a secret.
 * Other fields are kept as settings, and a blank clears them. A provider
 * without sign-in is then tested straight away, so "Saved" also says
 * whether it works.
 */
export async function saveIntegrationAction(providerId: string, values: Record<string, string>): Promise<IntegrationResult> {
  const me = await owner();
  if (!me) return { ok: false, error: "Only an owner can change integrations." };
  const provider = findProvider(providerId);
  if (!provider) return { ok: false, error: "That integration isn't known." };

  const secrets: Record<string, string> = {};
  const settings: Record<string, unknown> = {};
  for (const field of provider.fields) {
    const raw = values[field.key];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value.length > 4000) return { ok: false, error: `${field.label} is too long.` };
    if (field.secret) {
      if (value) secrets[field.key] = value;
    } else {
      settings[field.key] = value;
    }
  }

  try {
    await saveIntegration(me.organization_id, providerId, { secrets, settings, updatedBy: me.id });
    if (!provider.oauthStartPath) {
      const result = await runTest(me.organization_id, providerId);
      done();
      return result.ok ? { ok: true, message: "Saved and working." } : { ok: true, message: `Saved, but the test failed: ${result.error}` };
    }
    done();
    return { ok: true, message: "Saved. Now press Connect to sign in." };
  } catch (err) {
    log.error("integration.save_failed", err, { provider: providerId });
    return { ok: false, error: "Couldn't save. Is migration 0355 applied?" };
  }
}

async function runTest(organizationId: string, providerId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const provider = findProvider(providerId);
  if (!provider) return { ok: false, error: "That integration isn't known." };
  await freshenToken(organizationId, providerId);
  const row = await getIntegration(organizationId, providerId);
  if (!row) return { ok: false, error: "Nothing saved yet." };
  let result: { ok: true } | { ok: false; error: string };
  if (!provider.test) {
    result = row.secrets && Object.keys(row.secrets).length + Object.keys(row.settings).length > 0 ? { ok: true } : { ok: false, error: "Nothing saved yet." };
  } else {
    try {
      result = await provider.test(row.secrets ?? {}, row.settings ?? {});
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : "The test crashed." };
    }
  }
  // An OAuth provider that was never connected stays "not connected" when its test fails.
  const status = result.ok ? "connected" : provider.oauthStartPath && row.status === "not_connected" ? "not_connected" : "error";
  await saveIntegration(organizationId, providerId, { status, lastError: result.ok ? null : result.error });
  return result;
}

export async function testIntegrationAction(providerId: string): Promise<IntegrationResult> {
  const me = await owner();
  if (!me) return { ok: false, error: "Only an owner can test integrations." };
  try {
    const result = await runTest(me.organization_id, providerId);
    done();
    return result.ok ? { ok: true, message: "Working." } : { ok: false, error: result.error };
  } catch (err) {
    log.error("integration.test_failed", err, { provider: providerId });
    return { ok: false, error: "Couldn't run the test." };
  }
}

/** Forgets everything saved for the provider, tokens included, after telling the provider where it can. */
export async function disconnectIntegrationAction(providerId: string): Promise<IntegrationResult> {
  const me = await owner();
  if (!me) return { ok: false, error: "Only an owner can disconnect integrations." };
  try {
    if (providerId === "quickbooks") await revokeQuickBooks(me.organization_id);
    await disconnectIntegration(me.organization_id, providerId);
    done();
    return { ok: true, message: "Disconnected. Everything saved for it is gone." };
  } catch (err) {
    log.error("integration.disconnect_failed", err, { provider: providerId });
    return { ok: false, error: "Couldn't disconnect." };
  }
}

/** Revokes the refresh token at Intuit so the app's access ends there too. Best effort. */
async function revokeQuickBooks(organizationId: string): Promise<void> {
  const row = await getIntegration(organizationId, "quickbooks");
  const token = row?.secrets.refresh_token || row?.secrets.access_token;
  const clientId = (row?.settings.client_id as string) || row?.secrets.client_id;
  const clientSecret = row?.secrets.client_secret;
  if (!token || !clientId || !clientSecret) return;
  await fetch(QBO_REVOKE_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ token }),
  }).catch(() => undefined);
}

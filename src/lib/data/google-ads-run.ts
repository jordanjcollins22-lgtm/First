import type { SupabaseClient } from "@supabase/supabase-js";

import { adsAccountFrom, fetchDailySpend, fetchLsaLeads } from "@/lib/google/ads";
import { googleAccessToken } from "@/lib/google/oauth";
import { getIntegration, saveIntegration } from "@/lib/integrations/store";
import type { AutopilotSettings } from "@/lib/marketing/autopilot-settings";
import { adsRowsToSpend, lsaLeads, type SpendRow } from "@/lib/marketing/spend";

/**
 * The daily spend and leads import from Google Ads and Local Services Ads.
 *
 * Reads the last 30 days each time, because Google keeps adjusting the last
 * few days' numbers (invalid clicks refunded, LSA leads disputed). Every row
 * is keyed by channel, day and campaign, so reading a day again replaces it
 * rather than counting it twice.
 *
 * Read only: nothing is changed in either account. Runs with the service role.
 */

const untyped = (c: unknown) => c as SupabaseClient;

export const ADS_PROVIDERS = ["google_ads", "google_lsa"] as const;

export interface AdsRunResult {
  provider: string;
  connected: boolean;
  error?: string;
  spendRows: number;
  leads: number;
}

export function spendRowsForDb(org: string, rows: readonly SpendRow[], source: "api" | "csv" | "manual", by: string | null = null) {
  const now = new Date().toISOString();
  return rows.map((r) => ({
    organization_id: org,
    channel: r.channel,
    day: r.day,
    amount_cents: r.amountCents,
    clicks: r.clicks,
    impressions: r.impressions,
    platform_leads: r.platformLeads,
    campaign: r.campaign,
    source,
    external_key: r.externalKey,
    created_by: by,
    updated_at: now,
  }));
}

export async function runAdsImport(client: unknown, org: string, settings: AutopilotSettings, now = new Date()): Promise<AdsRunResult[]> {
  const sb = untyped(client);
  const out: AdsRunResult[] = [];
  for (const provider of ADS_PROVIDERS) {
    const row = await getIntegration(org, provider);
    if (!row || row.status === "not_connected") {
      out.push({ provider, connected: false, error: "Not connected — add it in Settings › Integrations.", spendRows: 0, leads: 0 });
      continue;
    }
    if (!settings.enabled.ads_import) {
      out.push({ provider, connected: true, error: "Import switched off.", spendRows: 0, leads: 0 });
      continue;
    }
    const auth = await googleAccessToken(row.secrets);
    const account = adsAccountFrom(row.secrets);
    if (!auth.ok || !account.ok) {
      const error = !auth.ok ? auth.error : !account.ok ? account.error : "";
      await saveIntegration(org, provider, { status: "error", lastError: error });
      out.push({ provider, connected: false, error, spendRows: 0, leads: 0 });
      continue;
    }
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
    const spend = await fetchDailySpend(auth.token, account.value, start, end);
    if (!spend.ok) {
      await saveIntegration(org, provider, { status: "error", lastError: spend.error });
      out.push({ provider, connected: true, error: spend.error, spendRows: 0, leads: 0 });
      continue;
    }
    // The LSA connection only brings LSA; the Ads one brings both kinds of
    // campaign. Keys are per channel, so both pointing at one account is fine.
    const rows = adsRowsToSpend(spend.value).filter((r) => provider === "google_ads" || r.channel === "google_lsa");
    if (rows.length > 0) {
      const { error } = await sb.from("marketing_spend").upsert(spendRowsForDb(org, rows, "api"), { onConflict: "organization_id,external_key" });
      if (error) console.error("[ads] spend save failed:", error.message);
    }
    let leadCount = 0;
    if (provider === "google_lsa") {
      const leads = await fetchLsaLeads(auth.token, account.value, start);
      if (leads.ok) {
        const parsed = lsaLeads(leads.value);
        leadCount = parsed.length;
        if (parsed.length > 0) {
          await sb.from("marketing_platform_leads").upsert(
            parsed.map((l) => ({
              organization_id: org,
              provider,
              external_id: l.externalId,
              lead_type: l.leadType,
              category: l.category,
              charged: l.charged,
              phone: l.phone,
              occurred_at: l.occurredAt,
            })),
            { onConflict: "organization_id,provider,external_id" }
          );
        }
      }
    }
    await saveIntegration(org, provider, { status: "connected", lastError: null });
    out.push({ provider, connected: true, spendRows: rows.length, leads: leadCount });
  }
  return out;
}

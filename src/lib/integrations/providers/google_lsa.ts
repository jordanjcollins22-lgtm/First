import { adsAccountFrom, fetchLsaLeads } from "@/lib/google/ads";
import { googleAccessToken } from "@/lib/google/oauth";
import type { IntegrationProvider } from "@/lib/integrations/types";

/**
 * Google Local Services Ads ("Google Guaranteed"): daily spend and the leads
 * it charged for. Read through the Google Ads API, so it needs the same kind
 * of values as Google Ads, and they may be the very same ones.
 */
export const googleLsaProvider: IntegrationProvider = {
  id: "google_lsa",
  name: "Google Local Services Ads",
  area: "Marketing",
  enables: "Daily LSA spend and every lead it charged for, so its cost per lead sits next to Search ads, hangers and the rest.",
  fields: [
    { key: "client_id", label: "OAuth client ID", help: "Can be the same as Google Ads." },
    { key: "client_secret", label: "OAuth client secret", secret: true },
    { key: "developer_token", label: "Developer token", secret: true, help: "The Google Ads developer token; the same one works." },
    { key: "customer_id", label: "LSA customer ID", placeholder: "123-456-7890", help: "The Google Ads account LSA is linked to (LSA dashboard › Settings)." },
    { key: "login_customer_id", label: "Manager account ID (optional)", placeholder: "123-456-7890" },
    { key: "api_version", label: "API version (optional)", placeholder: "v21" },
  ],
  howTo: [
    "Local Services Ads report through the Google Ads API. Get a developer token as for Google Ads (Tools › API Center).",
    "Find the Google Ads customer ID LSA is linked to: LSA dashboard › Settings › Linked accounts.",
    "Add the authorized redirect URI https://app.jslandscapingmd.com/api/integrations/google_lsa/callback to the OAuth client.",
    "Paste the values, save, press Connect and sign in.",
    "No API access? Download LSA spend as CSV and upload it on Marketing › Digital marketing.",
  ],
  docsUrl: "https://developers.google.com/google-ads/api/docs/local-services/overview",
  oauthStartPath: "/api/integrations/google_lsa/start",
  async test(secrets) {
    const auth = await googleAccessToken(secrets);
    if (!auth.ok) return { ok: false, error: auth.error };
    const account = adsAccountFrom(secrets);
    if (!account.ok) return { ok: false, error: account.error };
    const r = await fetchLsaLeads(auth.token, account.value, new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },
};

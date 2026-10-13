import { adsAccountFrom, fetchDailySpend } from "@/lib/google/ads";
import { googleAccessToken } from "@/lib/google/oauth";
import type { IntegrationProvider } from "@/lib/integrations/types";

/** Google Search ads: daily spend and conversions, for cost per lead and CAC. */
export const googleAdsProvider: IntegrationProvider = {
  id: "google_ads",
  name: "Google Ads",
  area: "Marketing",
  enables: "Daily spend, clicks and conversions per campaign, so cost per lead and cost per client show next to every other channel.",
  fields: [
    { key: "client_id", label: "OAuth client ID", placeholder: "1234-abc.apps.googleusercontent.com" },
    { key: "client_secret", label: "OAuth client secret", secret: true },
    { key: "developer_token", label: "Developer token", secret: true, help: "Google Ads › Tools › API Center. Basic access is enough." },
    { key: "customer_id", label: "Customer ID", placeholder: "123-456-7890", help: "The account the ads run in, top right in Google Ads." },
    { key: "login_customer_id", label: "Manager account ID (optional)", placeholder: "123-456-7890", help: "Only if the ads account sits under a manager (MCC) account." },
    { key: "api_version", label: "API version (optional)", placeholder: "v21", help: "Leave empty unless Google has retired the default." },
  ],
  howTo: [
    "In Google Ads, open Tools › API Center and apply for a developer token (needs a manager account; Basic access is approved in a few days).",
    "In Google Cloud Console, enable the Google Ads API on the same project as the Business Profile, and use (or make) a Web application OAuth client.",
    "Add the authorized redirect URI https://app.jslandscapingmd.com/api/integrations/google_ads/callback.",
    "Paste the client ID, secret, developer token and customer ID here, save, then press Connect and sign in with a Google account that can see the ads account.",
    "No API access? Upload a CSV of spend from Google Ads › Reports on Marketing › Digital marketing instead.",
  ],
  docsUrl: "https://developers.google.com/google-ads/api/docs/get-started/introduction",
  oauthStartPath: "/api/integrations/google_ads/start",
  async test(secrets) {
    const auth = await googleAccessToken(secrets);
    if (!auth.ok) return { ok: false, error: auth.error };
    const account = adsAccountFrom(secrets);
    if (!account.ok) return { ok: false, error: account.error };
    const today = new Date().toISOString().slice(0, 10);
    const r = await fetchDailySpend(auth.token, account.value, today, today);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  },
};

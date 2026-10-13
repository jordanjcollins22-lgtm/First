/**
 * Google Ads and Local Services Ads, read only: what was spent each day and
 * which leads LSA charged for.
 *
 * Both come through the Google Ads API, which needs three things besides the
 * sign-in: a developer token (from the Ads account's API Center), the account
 * number the ads run in, and, when that account sits under a manager account,
 * the manager's number. LSA is a campaign type inside an Ads account
 * (LOCAL_SERVICES), and its leads are the local_services_lead resource.
 *
 * Server only. Nothing here throws.
 */

import type { AdsRow, LsaLeadRow } from "@/lib/marketing/spend";

/** The Ads API version. Google retires one roughly every year; the owner can override it as a field. */
export const GOOGLE_ADS_API_VERSION = "v21";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface AdsAccount {
  developerToken: string;
  customerId: string;
  loginCustomerId: string | null;
  version: string;
}

const digits = (v: string | undefined | null) => (v ?? "").replace(/\D/g, "");

/** The account details from saved secrets, or what is missing. */
export function adsAccountFrom(secrets: Record<string, string> | null): Result<AdsAccount> {
  if (!secrets?.developer_token) return { ok: false, error: "Add the Google Ads developer token in Settings › Integrations." };
  const customerId = digits(secrets.customer_id);
  if (customerId.length !== 10) return { ok: false, error: "Add the 10-digit Google Ads customer ID in Settings › Integrations." };
  const login = digits(secrets.login_customer_id);
  return {
    ok: true,
    value: {
      developerToken: secrets.developer_token,
      customerId,
      loginCustomerId: login.length === 10 ? login : null,
      version: /^v\d+$/.test(secrets.api_version ?? "") ? secrets.api_version : GOOGLE_ADS_API_VERSION,
    },
  };
}

async function search<T>(token: string, account: AdsAccount, query: string): Promise<Result<T[]>> {
  const out: T[] = [];
  let pageToken: string | undefined;
  try {
    for (let page = 0; page < 20; page++) {
      const response = await fetch(`https://googleads.googleapis.com/${account.version}/customers/${account.customerId}/googleAds:search`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "developer-token": account.developerToken,
          "content-type": "application/json",
          ...(account.loginCustomerId ? { "login-customer-id": account.loginCustomerId } : {}),
        },
        body: JSON.stringify(pageToken ? { query, pageToken } : { query }),
      });
      const json = (await response.json().catch(() => ({}))) as {
        results?: T[];
        nextPageToken?: string;
        error?: { message?: string; details?: { errors?: { message?: string }[] }[] };
      };
      if (!response.ok || json.error) {
        const detail = json.error?.details?.[0]?.errors?.[0]?.message;
        return { ok: false, error: detail || json.error?.message || `Google Ads answered ${response.status}.` };
      }
      out.push(...(json.results ?? []));
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return { ok: true, value: out };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not reach Google Ads." };
  }
}

/** Spend, clicks and conversions per campaign per day, LSA campaigns included. */
export function fetchDailySpend(token: string, account: AdsAccount, start: string, end: string): Promise<Result<AdsRow[]>> {
  return search<AdsRow>(
    token,
    account,
    "SELECT segments.date, campaign.id, campaign.name, campaign.advertising_channel_type, " +
      "metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions " +
      `FROM campaign WHERE segments.date BETWEEN '${start}' AND '${end}'`
  );
}

/** Leads Local Services Ads recorded since a date (YYYY-MM-DD). */
export function fetchLsaLeads(token: string, account: AdsAccount, since: string): Promise<Result<LsaLeadRow[]>> {
  return search<LsaLeadRow>(
    token,
    account,
    "SELECT local_services_lead.id, local_services_lead.lead_type, local_services_lead.category_id, " +
      "local_services_lead.contact_details, local_services_lead.lead_charged, local_services_lead.creation_date_time " +
      `FROM local_services_lead WHERE local_services_lead.creation_date_time >= '${since} 00:00:00'`
  );
}

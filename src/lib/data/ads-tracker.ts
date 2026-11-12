import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { DataScope } from "@/lib/data/review-scope";
import type { AdSpend } from "@/lib/ads-tracker";

export interface DatedAdSpend extends AdSpend {
  day: string;
}

/** Google Ads spend per campaign per day for the last year, as the daily import (or a CSV) recorded it. */
export async function listGoogleAdsSpend(days = 365, scope?: DataScope): Promise<DatedAdSpend[]> {
  const supabase = scope?.client ?? (await createClient());
  const organizationId = scope?.organizationId ?? (await getCurrentOrganizationId());
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("marketing_spend")
    .select("day, campaign, amount_cents, clicks")
    .eq("organization_id", organizationId)
    .eq("channel", "google_ads")
    .gte("day", since)
    .limit(10000);
  if (error) throw error;
  return ((data ?? []) as { day: string; campaign: string | null; amount_cents: number | null; clicks: number | null }[]).map((r) => ({
    day: r.day,
    campaign: r.campaign,
    amountCents: Number(r.amount_cents ?? 0),
    clicks: Number(r.clicks ?? 0),
  }));
}

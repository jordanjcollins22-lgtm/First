/**
 * How each Google Ads campaign is doing, on one page: what it cost, the
 * clicks, the leads it brought, the jobs sold and the money back.
 *
 * Every ad carries a tracked link: the campaign's name rides on the link as
 * utm tags (the Final URL suffix below), Google adds its own click id, and
 * both are kept with the booking. So a sold job is traced to the campaign
 * that found it. Leads from a Google ad with no campaign on the link are
 * counted under "No campaign on the link", which is the sign the suffix is
 * missing from a campaign.
 *
 * Pure, so the arithmetic is tested without a database.
 */

export const UNTAGGED = "No campaign on the link";

export interface AdSpend {
  campaign: string | null;
  amountCents: number;
  clicks: number;
}

export interface AdLead {
  source: { group: string; detail: string | null };
  sold: boolean;
  /** What the client actually paid. */
  collected: number;
}

export interface CampaignRow {
  campaign: string;
  spend: number;
  clicks: number;
  leads: number;
  sold: number;
  collected: number;
  /** Spend per lead, null with no leads. */
  costPerLead: number | null;
  /** Money back for every dollar spent, null with no spend. */
  returnPerDollar: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The Final URL suffix to paste into a campaign, so every click on its ads carries the campaign's name. */
export function finalUrlSuffix(campaign: string): string {
  const name = campaign.replace(/[^\w .:/~+-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return new URLSearchParams({ utm_source: "google", utm_medium: "cpc", utm_campaign: name }).toString();
}

export function adsTracker(spend: AdSpend[], leads: AdLead[]): CampaignRow[] {
  const by = new Map<string, CampaignRow>();
  const row = (campaign: string) => {
    const r = by.get(campaign) ?? { campaign, spend: 0, clicks: 0, leads: 0, sold: 0, collected: 0, costPerLead: null, returnPerDollar: null };
    by.set(campaign, r);
    return r;
  };
  for (const s of spend) {
    const r = row(s.campaign?.trim() || UNTAGGED);
    r.spend = round2(r.spend + s.amountCents / 100);
    r.clicks += s.clicks;
  }
  for (const l of leads) {
    if (l.source.group !== "Google ad") continue;
    const r = row(l.source.detail?.trim() || UNTAGGED);
    r.leads += 1;
    if (l.sold) r.sold += 1;
    r.collected = round2(r.collected + Math.max(0, l.collected));
  }
  return [...by.values()]
    .map((r) => ({
      ...r,
      costPerLead: r.leads ? round2(r.spend / r.leads) : null,
      returnPerDollar: r.spend > 0 ? round2(r.collected / r.spend) : null,
    }))
    .sort((a, b) => Number(a.campaign === UNTAGGED) - Number(b.campaign === UNTAGGED) || b.spend - a.spend || a.campaign.localeCompare(b.campaign));
}

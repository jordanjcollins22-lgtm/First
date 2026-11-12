/**
 * Turning a finished job's photo into a Google ad the owner only has to
 * approve.
 *
 * Every finished job with an "after" photo becomes a draft: the photo, the
 * words (made from the services done and the town), a daily budget chosen
 * from how the ads have been doing, and what that budget should bring back.
 * Nothing goes to Google until the owner taps Approve; then it launches live.
 *
 * Pure, so the rules and the request sent to Google are tested without
 * either a database or Google.
 */

import { finalUrlSuffix, type CampaignRow } from "@/lib/ads-tracker";

/** The budgets a draft can suggest, a day. */
export const BUDGET_STEPS_CENTS = [1000, 2000, 3000, 5000] as const;

/** What a new ad is assumed to cost a lead when there is no history yet. */
export const DEFAULT_COST_PER_LEAD = 60;
export const DEFAULT_CLOSE_RATE = 0.3;
export const DEFAULT_AVERAGE_JOB = 900;

export interface Performance {
  costPerLead: number;
  closeRate: number;
  averageJob: number;
  /** Money back per dollar spent, null with no history. */
  returnPerDollar: number | null;
  /** True when the numbers come from the business's own ads, false when they are a starting guess. */
  fromHistory: boolean;
}

/** How the Google ads have been doing, all campaigns together. */
export function performanceFrom(rows: CampaignRow[]): Performance {
  const spend = rows.reduce((n, r) => n + r.spend, 0);
  const leads = rows.reduce((n, r) => n + r.leads, 0);
  const sold = rows.reduce((n, r) => n + r.sold, 0);
  const collected = rows.reduce((n, r) => n + r.collected, 0);
  if (spend <= 0 || leads === 0) {
    return { costPerLead: DEFAULT_COST_PER_LEAD, closeRate: DEFAULT_CLOSE_RATE, averageJob: DEFAULT_AVERAGE_JOB, returnPerDollar: null, fromHistory: false };
  }
  return {
    costPerLead: spend / leads,
    closeRate: sold / leads,
    averageJob: sold ? collected / sold : DEFAULT_AVERAGE_JOB,
    returnPerDollar: collected / spend,
    fromHistory: true,
  };
}

/** The daily budget to suggest: more where the ads have paid back, the least while they haven't, or with no history. */
export function suggestBudgetCents(p: Performance): number {
  if (!p.fromHistory || p.returnPerDollar == null || p.returnPerDollar < 1) return BUDGET_STEPS_CENTS[0];
  if (p.returnPerDollar < 2) return BUDGET_STEPS_CENTS[1];
  if (p.returnPerDollar < 4) return BUDGET_STEPS_CENTS[2];
  return BUDGET_STEPS_CENTS[3];
}

export interface Estimate {
  /** Over 30 days. */
  spend: number;
  leads: number;
  jobs: number;
  revenue: number;
  /** Money back per dollar spent. */
  returnPerDollar: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** What a daily budget should bring in over 30 days, at the rates the ads have shown. */
export function estimateReturn(dailyBudgetCents: number, p: Performance): Estimate {
  const spend = (dailyBudgetCents / 100) * 30;
  const leads = p.costPerLead > 0 ? spend / p.costPerLead : 0;
  const jobs = leads * p.closeRate;
  const revenue = jobs * p.averageJob;
  return {
    spend: Math.round(spend),
    leads: round1(leads),
    jobs: round1(jobs),
    revenue: Math.round(revenue),
    returnPerDollar: spend > 0 ? Math.round((revenue / spend) * 100) / 100 : 0,
  };
}

export interface AdCopy {
  /** Up to 30 characters each; Google wants at least 3. */
  headlines: string[];
  /** Up to 90 characters each; Google wants at least 2. */
  descriptions: string[];
}

const fit = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, "").trim());

/** The words for an ad, from the services done and the town they were done in. */
export function adCopy(input: { services: string[]; town: string | null; business: string }): AdCopy {
  const service = input.services[0] ?? "Landscaping";
  const town = input.town;
  const headlines = [
    town ? `${service} in ${town}` : service,
    "Free Estimate",
    "See Our Latest Work",
    fit(input.business, 30),
    town ? `Local Landscaper, ${town}` : "Local Landscaper",
  ]
    .map((h) => fit(h, 30))
    .filter((h, i, all) => h && all.indexOf(h) === i);
  for (const spare of ["Book Online Today", "Insured and Local"]) if (headlines.length < 3) headlines.push(spare);
  const descriptions = [
    fit(`${service} just finished${town ? ` in ${town}` : ""}. See the before and after, then book your free estimate.`, 90),
    fit(`${input.business}: local crews, clear prices, and photos of every job when it's done.`, 90),
  ];
  return { headlines, descriptions };
}

/** A US five-digit ZIP from an address, for aiming the ad at the neighbourhood the job was in. */
export function zipFromAddress(address: string | null | undefined): string | null {
  return address?.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)?.[1] ?? null;
}

export interface LaunchInput {
  customerId: string;
  name: string;
  dailyBudgetCents: number;
  copy: AdCopy;
  /** Keywords the ad shows for. */
  keywords: string[];
  /** Where the ad sends people: the booking page. */
  finalUrl: string;
  /** The photo, base64. */
  imageBase64: string;
  /** The ZIP to aim at, and how far around it, in miles. */
  zip: string | null;
  radiusMiles: number;
}

/**
 * The one request that launches an ad, all or nothing: the photo as an image
 * asset, a budget, a live Search campaign aimed around the job's ZIP, an ad
 * group, a responsive search ad, keywords, and the photo attached to the
 * campaign. The campaign's name rides on every click as the tracked link.
 */
export function launchOperations(input: LaunchInput): Record<string, unknown>[] {
  const c = `customers/${input.customerId}`;
  const asset = `${c}/assets/-1`;
  const budget = `${c}/campaignBudgets/-2`;
  const campaign = `${c}/campaigns/-3`;
  const adGroup = `${c}/adGroups/-4`;
  const ops: Record<string, unknown>[] = [
    { assetOperation: { create: { resourceName: asset, name: `${input.name} photo`, type: "IMAGE", imageAsset: { data: input.imageBase64 } } } },
    {
      campaignBudgetOperation: {
        create: { resourceName: budget, name: `${input.name} budget`, amountMicros: String(input.dailyBudgetCents * 10_000), deliveryMethod: "STANDARD", explicitlyShared: false },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaign,
          name: input.name,
          status: "ENABLED",
          advertisingChannelType: "SEARCH",
          campaignBudget: budget,
          targetSpend: {},
          networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
          finalUrlSuffix: finalUrlSuffix(input.name),
          containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        },
      },
    },
  ];
  if (input.zip) {
    ops.push({
      campaignCriterionOperation: {
        create: {
          campaign,
          proximity: { address: { postalCode: input.zip, countryCode: "US" }, radius: input.radiusMiles, radiusUnits: "MILES" },
        },
      },
    });
  }
  ops.push(
    { adGroupOperation: { create: { resourceName: adGroup, name: `${input.name} ads`, campaign, status: "ENABLED", type: "SEARCH_STANDARD" } } },
    {
      adGroupAdOperation: {
        create: {
          adGroup,
          status: "ENABLED",
          ad: {
            finalUrls: [input.finalUrl],
            responsiveSearchAd: {
              headlines: input.copy.headlines.map((text) => ({ text })),
              descriptions: input.copy.descriptions.map((text) => ({ text })),
            },
          },
        },
      },
    },
    ...input.keywords.map((text) => ({
      adGroupCriterionOperation: { create: { adGroup, status: "ENABLED", keyword: { text: fit(text, 80), matchType: "PHRASE" } } },
    })),
    { campaignAssetOperation: { create: { campaign, asset, fieldType: "AD_IMAGE" } } }
  );
  return ops;
}

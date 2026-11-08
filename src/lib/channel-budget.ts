import { SHARE_PCT } from "@/lib/commission-split";
import type { LeadSource } from "@/lib/lead-sources";

/**
 * The growth budget for each marketing channel.
 *
 * The affiliate's 4% is paid on what the client actually paid, to the one
 * person who brought the job in. When nobody did (the job came from an ad, a
 * flyer, a yard sign, the website), that 4% is not kept: it goes into a
 * budget for the channel the job came from, to spend growing that channel.
 *
 * Pure, so the rule is tested without a database.
 */

export const CHANNEL_PCT = SHARE_PCT.affiliate;

export interface BudgetLead {
  source: LeadSource;
  /** What the client actually paid on the job so far. */
  collected: number;
  /** Whether a person who earns the affiliate share brought the job in. */
  hasAffiliate: boolean;
}

export interface ChannelBudget {
  group: string;
  /** Jobs with money in that nobody brought in. */
  jobs: number;
  collected: number;
  budget: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One row per channel, biggest budget first. A job somebody brought in pays them, not the channel. */
export function channelBudgets(leads: BudgetLead[], pct: number = CHANNEL_PCT): ChannelBudget[] {
  const by = new Map<string, ChannelBudget>();
  for (const lead of leads) {
    if (lead.hasAffiliate || !(lead.collected > 0)) continue;
    const row = by.get(lead.source.group) ?? { group: lead.source.group, jobs: 0, collected: 0, budget: 0 };
    row.jobs += 1;
    row.collected = round2(row.collected + lead.collected);
    by.set(row.group, row);
  }
  return [...by.values()]
    .map((r) => ({ ...r, budget: round2((r.collected * pct) / 100) }))
    .sort((a, b) => b.budget - a.budget || a.group.localeCompare(b.group));
}

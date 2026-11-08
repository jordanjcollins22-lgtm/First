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

/**
 * The day the affiliate 4% started being counted here (Jordan, 2026-11-08).
 * Older jobs were not tracked well enough to pay on, so they stay out of it.
 */
export const COMMISSIONS_FROM = "2026-11-08";

export interface BudgetLead {
  source: LeadSource;
  /** What the client actually paid on the job so far. */
  collected: number;
  /** Whether a person who earns the affiliate share brought the job in. */
  hasAffiliate: boolean;
  /** That person's first name, when one did. */
  affiliate?: string | null;
}

export interface ChannelBudget {
  group: string;
  /** Jobs with money in that nobody brought in. */
  jobs: number;
  collected: number;
  budget: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Sources that only say "it came through the booking calendar": the client's own answer says more. */
const VAGUE = new Set(["GoHighLevel calendar", "Booked online, no trail"]);

/**
 * The channel a job's 4% goes back into. A calendar booking is put under what
 * the client said brought them (e.g. "Google"), so the money goes to that page's ads.
 */
export function channelOf(source: LeadSource): string {
  return VAGUE.has(source.group) && source.detail ? `${source.detail} (client said)` : source.group;
}

/** One row per channel, biggest budget first. A job somebody brought in pays them, not the channel. */
export function channelBudgets(leads: BudgetLead[], pct: number = CHANNEL_PCT): ChannelBudget[] {
  const by = new Map<string, ChannelBudget>();
  for (const lead of leads) {
    if (lead.hasAffiliate || !(lead.collected > 0)) continue;
    const group = channelOf(lead.source);
    const row = by.get(group) ?? { group, jobs: 0, collected: 0, budget: 0 };
    row.jobs += 1;
    row.collected = round2(row.collected + lead.collected);
    by.set(row.group, row);
  }
  return [...by.values()]
    .map((r) => ({ ...r, budget: round2((r.collected * pct) / 100) }))
    .sort((a, b) => b.budget - a.budget || a.group.localeCompare(b.group));
}

export interface PersonCut {
  name: string;
  /** Jobs with money in that this person brought in. */
  jobs: number;
  collected: number;
  /** The 4% paid to them. */
  cut: number;
}

export interface AffiliateSplit {
  /** Leads a person brought in, and leads from everything else (ads, posts, the calendar, automations). */
  peopleLeads: number;
  sourceLeads: number;
  /** Each person's 4%, biggest first. */
  people: PersonCut[];
  /** Each channel's 4%, to spend on that channel's ads, biggest first. */
  sources: ChannelBudget[];
}

/**
 * The whole affiliate 4%, split two ways: a job a person brought in pays that
 * person; any other job's 4% goes back into ads on the channel it came from.
 */
export function affiliateSplit(leads: BudgetLead[], pct: number = CHANNEL_PCT): AffiliateSplit {
  const by = new Map<string, PersonCut>();
  let peopleLeads = 0;
  for (const lead of leads) {
    if (!lead.hasAffiliate) continue;
    peopleLeads += 1;
    if (!(lead.collected > 0)) continue;
    const name = lead.affiliate || "A team member";
    const row = by.get(name) ?? { name, jobs: 0, collected: 0, cut: 0 };
    row.jobs += 1;
    row.collected = round2(row.collected + lead.collected);
    by.set(name, row);
  }
  return {
    peopleLeads,
    sourceLeads: leads.length - peopleLeads,
    people: [...by.values()]
      .map((r) => ({ ...r, cut: round2((r.collected * pct) / 100) }))
      .sort((a, b) => b.cut - a.cut || a.name.localeCompare(b.name)),
    sources: channelBudgets(leads, pct),
  };
}

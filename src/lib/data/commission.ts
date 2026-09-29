import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation, type JobWithLocation } from "@/lib/data/jobs";
import { canDoEvaluations } from "@/lib/affiliate-roles";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { describeShare, shareRule, sharesFor, usesSplit, type JobRoles } from "@/lib/commission-split";
import {
  commissionFor,
  type CommissionJobInput,
  type CommissionLine,
  type CommissionSummary,
} from "@/lib/commission";
import type { Profile } from "@/types/domain";
import { agreedTotal } from "@/lib/agreed-total";

async function safe<T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await query;
    return data ?? [];
  } catch {
    return [];
  }
}

export interface JobMoney {
  collected: Map<string, number>;
  /** What the client handed over, card fee and all: whether they have paid the whole price. */
  paidByClient: Map<string, number>;
  contract: Map<string, number | null>;
  openTickets: Map<string, number>;
  /** Commission already handed over, per job. */
  paidOut: Map<string, number>;
  lastPaidAt: Map<string, string>;
  /** The same, per job and person: `${jobId}:${profileId}`. A split job pays three people. */
  paidOutBy: Map<string, number>;
  lastPaidAtBy: Map<string, string>;
  /** When the client said yes: the accepted proposal's answer. */
  soldAt: Map<string, string>;
  /** Open issues traced back to the site map, which hold the evaluator's share. */
  designIssues: Map<string, number>;
}

/**
 * What came in, what was promised, and what is still open — for a set of jobs.
 *
 * Collected is assembled from both halves of how this business gets paid:
 * invoices that actually cleared, and the cash and cheques recorded on the
 * ledger against the job. Counting only one of them would undercount every
 * driveway job paid by cheque, which is most of them.
 *
 * Fetched for every job at once rather than per manager, so adding a fifth
 * account manager does not add four more round trips.
 */
export async function loadMoney(jobIds: string[]): Promise<JobMoney> {
  // Once per page for the same jobs: the commission and the advances on
  // My Day both ask.
  return loadMoneyFor([...new Set(jobIds)].sort().join(","));
}

const loadMoneyFor = cache(async function loadMoneyFor(key: string): Promise<JobMoney> {
  return readMoney(key ? key.split(",") : []);
});

async function readMoney(jobIds: string[]): Promise<JobMoney> {
  const empty: JobMoney = {
    collected: new Map(),
    paidByClient: new Map(),
    contract: new Map(),
    openTickets: new Map(),
    paidOut: new Map(),
    lastPaidAt: new Map(),
    paidOutBy: new Map(),
    lastPaidAtBy: new Map(),
    soldAt: new Map(),
    designIssues: new Map(),
  };
  if (jobIds.length === 0) return empty;

  const supabase = await createClient();
  const [invoices, ledger, proposals, tickets, payouts, payments] = await Promise.all([
    safe(supabase.from("invoices").select("id, job_id, amount, status, paid_at, stripe_invoice_id").in("job_id", jobIds)),
    safe(
      supabase.from("ledger_entries").select("job_id, amount, direction").eq("direction", "in").in("job_id", jobIds)
    ),
    safe(supabase.from("job_proposals").select("job_id, total_cost, discount_amount, status, responded_at, approved_at").in("job_id", jobIds)),
    safe(supabase.from("job_tickets").select("job_id, status, cause").in("job_id", jobIds)),
    safe(supabase.from("commission_payouts").select("job_id, profile_id, amount, paid_at").in("job_id", jobIds)),
    // The payments table is where Stripe and the hand-recorded cheques both
    // land, and until now nothing here read it: commission was worked out
    // from invoices and the ledger, which were empty, while a hundred card
    // payments sat in a table this never opened.
    safe(
      supabase
        .from("payments")
        .select("job_id, amount_cents, surcharge_cents, invoice_id, stripe_invoice_id")
        .in("job_id", jobIds)
    ),
  ]);

  const collected = new Map<string, number>();
  const paidByClient = new Map<string, number>();
  const add = (jobId: string | null, amount: number, fee = 0) => {
    if (!jobId) return;
    collected.set(jobId, (collected.get(jobId) ?? 0) + amount);
    paidByClient.set(jobId, (paidByClient.get(jobId) ?? 0) + amount + fee);
  };

  // Money that arrived, fee excluded. The card fee is not money against the
  // job, and paying commission on it would pay the manager a share of what
  // Stripe kept.
  const coveredInvoices = new Set<string>();
  for (const row of payments as {
    job_id: string | null;
    amount_cents: number;
    surcharge_cents: number | null;
    invoice_id: string | null;
    stripe_invoice_id: string | null;
  }[]) {
    add(row.job_id, (row.amount_cents - (row.surcharge_cents ?? 0)) / 100, (row.surcharge_cents ?? 0) / 100);
    if (row.invoice_id) coveredInvoices.add(row.invoice_id);
    if (row.stripe_invoice_id) coveredInvoices.add(row.stripe_invoice_id);
  }

  // A paid invoice is money. A sent one is a claim, and claims do not pay
  // commission. An invoice whose payment is already counted above is not
  // counted again.
  for (const inv of invoices as {
    id: string;
    job_id: string;
    amount: number;
    status: string;
    paid_at: string | null;
    stripe_invoice_id: string | null;
  }[]) {
    if (coveredInvoices.has(inv.id) || (inv.stripe_invoice_id && coveredInvoices.has(inv.stripe_invoice_id))) continue;
    if (inv.paid_at || inv.status === "paid") add(inv.job_id, Number(inv.amount) || 0);
  }
  for (const row of ledger as { job_id: string | null; amount: number }[]) {
    add(row.job_id, Number(row.amount) || 0);
  }

  const contract = new Map<string, number | null>(
    // After the discount. Against the full price a discounted job reads as
    // short forever, and its commission never stops "still to come".
    (proposals as { job_id: string; total_cost: number | null; discount_amount: number | null }[]).map((p) => [
      p.job_id,
      agreedTotal(p),
    ])
  );

  const soldAt = new Map<string, string>();
  for (const p of proposals as { job_id: string; status: string | null; responded_at: string | null; approved_at: string | null }[]) {
    const at = p.status === "accepted" ? (p.responded_at ?? p.approved_at) : null;
    const seen = soldAt.get(p.job_id);
    if (at && (!seen || at < seen)) soldAt.set(p.job_id, at);
  }

  const openTickets = new Map<string, number>();
  const designIssues = new Map<string, number>();
  for (const t of tickets as { job_id: string; status: string; cause: string | null }[]) {
    // Resolved and closed tickets are the record of something already dealt
    // with. Only the ones somebody still owes a trip for hold a payout.
    if (t.status === "open" || t.status === "scheduled") {
      openTickets.set(t.job_id, (openTickets.get(t.job_id) ?? 0) + 1);
      if (t.cause === "design") designIssues.set(t.job_id, (designIssues.get(t.job_id) ?? 0) + 1);
    }
  }

  // What has actually been handed over. Summed rather than flagged: a job
  // part paid and then collected on again owes the difference, and a flag
  // would say settled and be wrong.
  const paidOut = new Map<string, number>();
  const lastPaidAt = new Map<string, string>();
  const paidOutBy = new Map<string, number>();
  const lastPaidAtBy = new Map<string, string>();
  for (const row of payouts as { job_id: string; profile_id: string; amount: number; paid_at: string }[]) {
    const amount = Number(row.amount) || 0;
    paidOut.set(row.job_id, (paidOut.get(row.job_id) ?? 0) + amount);
    const seen = lastPaidAt.get(row.job_id);
    if (!seen || row.paid_at > seen) lastPaidAt.set(row.job_id, row.paid_at);
    const key = `${row.job_id}:${row.profile_id}`;
    paidOutBy.set(key, (paidOutBy.get(key) ?? 0) + amount);
    const seenBy = lastPaidAtBy.get(key);
    if (!seenBy || row.paid_at > seenBy) lastPaidAtBy.set(key, row.paid_at);
  }

  return { collected, paidByClient, contract, openTickets, paidOut, lastPaidAt, paidOutBy, lastPaidAtBy, soldAt, designIssues };
}


/** Sold work: past the client's yes. */
const SOLD = new Set(["approved", "scheduled", "in_progress", "completed"]);

/** The owner: whose business it is, so no share is theirs. */
function isOwner(roles: string[]): boolean {
  return roles.some((r) => ["admin", "owner"].includes(r.toLowerCase().trim()));
}

interface PoolPerson {
  id: string;
  name: string;
  pct: number | null;
  owner: boolean;
  /** Can be sent to walk a property: whose site map it would be. */
  evaluates: boolean;
}

/** Everybody who could hold a share, the day the split started, and whose link each referral code is. */
export interface PoolContext {
  people: Map<string, PoolPerson>;
  splitFrom: string;
  posterByCode: Map<string, string>;
}

/** Once per page, however many books are worked out on it. */
export const loadPoolContext = cache(async function loadPoolContext(): Promise<PoolContext> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const [{ data: profiles }, { data: roleRows }, { data: org }, { data: links }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, commission_pct, does_evaluations").eq("organization_id", organizationId),
    supabase.from("profile_roles").select("profile_id, role_name"),
    supabase.from("organizations").select("commission_split_from").eq("id", organizationId).maybeSingle(),
    supabase.from("outreach_links").select("code, profile_id").eq("organization_id", organizationId),
  ]);
  const rolesOf = new Map<string, string[]>();
  for (const r of (roleRows ?? []) as { profile_id: string; role_name: string }[]) {
    rolesOf.set(r.profile_id, [...(rolesOf.get(r.profile_id) ?? []), r.role_name]);
  }
  const people = new Map<string, PoolPerson>();
  for (const p of (profiles ?? []) as { id: string; full_name: string | null; email: string | null; commission_pct: number | string | null; does_evaluations: boolean | null }[]) {
    const roles = rolesOf.get(p.id) ?? [];
    people.set(p.id, {
      id: p.id,
      name: p.full_name || p.email || "Somebody",
      pct: p.commission_pct == null ? null : Number(p.commission_pct),
      owner: isOwner(roles),
      evaluates: canDoEvaluations(roles, p.does_evaluations),
    });
  }
  return {
    people,
    splitFrom: (org as { commission_split_from?: string | null } | null)?.commission_split_from ?? "2026-09-29",
    posterByCode: new Map(((links ?? []) as { code: string; profile_id: string }[]).map((l) => [l.code, l.profile_id])),
  };
});

type JobWithCode = JobWithLocation & { referral_code?: string | null; created_at?: string | null };

/** Who filled each share of the pool on a job, before anybody is left out. */
function rolesOn(job: JobWithCode, ctx: PoolContext): JobRoles {
  const evaluator = job.assigned_to && ctx.people.get(job.assigned_to)?.evaluates ? job.assigned_to : null;
  const affiliate = job.referred_by_profile_id ?? (job.referral_code ? (ctx.posterByCode.get(job.referral_code) ?? null) : null);
  return {
    accountManagerId: job.property.customer.account_manager_id ?? null,
    evaluatorId: evaluator,
    affiliateId: affiliate && ctx.people.has(affiliate) ? affiliate : null,
  };
}

/** Whether somebody might hold a share on a job: worth loading its money for. */
function touches(job: JobWithCode, ctx: PoolContext, profileId?: string): boolean {
  const r = rolesOn(job, ctx);
  const ids = [r.accountManagerId, r.evaluatorId, r.affiliateId].filter((id): id is string => Boolean(id));
  return profileId ? ids.includes(profileId) : ids.length > 0;
}

/**
 * Every share of commission on these jobs, per person.
 *
 * A project sold before the split started keeps the deal it was sold on: the
 * account manager at their own rate. One sold since pays out of the 15% pool,
 * 7% to the account manager, 4% to the evaluator, 4% to the affiliate, each
 * a line of their own, paid and tracked apart. An evaluator's or affiliate's
 * share is only a line once the client has said yes.
 */
export function sharesByPerson(jobs: JobWithCode[], money: JobMoney, ctx: PoolContext): Map<string, CommissionJobInput[]> {
  const by = new Map<string, CommissionJobInput[]>();
  const owners = new Set([...ctx.people.values()].filter((p) => p.owner).map((p) => p.id));
  for (const job of jobs) {
    if (job.status === "cancelled") continue;
    const base = {
      jobId: job.id,
      customerName: job.property.customer.name,
      address: job.property.address,
      status: job.status,
      completedAt: job.completed_at,
      collected: money.collected.get(job.id) ?? 0,
      // The proposal total is what the job is worth if it all comes in. It is
      // context for the collected figure, never the basis for the commission.
      contractValue: money.contract.get(job.id) ?? null,
      openTickets: money.openTickets.get(job.id) ?? 0,
    };
    const paid = (profileId: string) => ({
      paidOut: money.paidOutBy.get(`${job.id}:${profileId}`) ?? 0,
      lastPaidAt: money.lastPaidAtBy.get(`${job.id}:${profileId}`) ?? null,
    });
    const push = (profileId: string, input: CommissionJobInput) => by.set(profileId, [...(by.get(profileId) ?? []), input]);

    const roles = rolesOn(job, ctx);
    const sold = SOLD.has(job.status);
    // Work done before proposals were answered in the app has no yes on
    // record; it was sold when it was booked.
    const soldAt = money.soldAt.get(job.id) ?? (sold ? (job.created_at ?? job.completed_at ?? "2000-01-01") : null);
    if (!usesSplit(soldAt, ctx.splitFrom)) {
      const manager = roles.accountManagerId;
      if (manager && ctx.people.has(manager) && !owners.has(manager)) push(manager, { ...base, ...paid(manager), roleLabel: "Sold before the pool" });
      continue;
    }
    const earning = sold || money.soldAt.has(job.id) ? roles : { accountManagerId: roles.accountManagerId, evaluatorId: null, affiliateId: null };
    for (const share of sharesFor(earning, owners)) {
      const rule = shareRule(share.roles, money.designIssues.get(job.id) ?? 0);
      push(share.profileId, {
        ...base,
        ...paid(share.profileId),
        pct: share.pct,
        roleLabel: describeShare(share.roles),
        onCollect: rule.onCollect,
        hold: rule.hold,
      });
    }
  }
  return by;
}

/** One person's book: every share they hold, as account manager, evaluator or affiliate. */
export async function getCommissionFor(profile: Profile): Promise<CommissionSummary> {
  // Most of the crew can hold no share at all: not an account manager, not
  // sent to evaluate, nobody booked through them. Three tiny lookups say so,
  // instead of every job and its money on a page the crew's phone re-reads
  // all morning.
  if (!(await mightHoldAShare(profile))) return commissionFor([], profile.commission_pct);

  const [all, ctx] = await Promise.all([listJobsWithLocation(), loadPoolContext()]);
  const mine = (all as JobWithCode[]).filter((j) => touches(j, ctx, profile.id));
  if (mine.length === 0) return commissionFor([], profile.commission_pct);

  const money = await loadMoney(mine.map((j) => j.id));
  return commissionFor(sharesByPerson(mine, money, ctx).get(profile.id) ?? [], profile.commission_pct);
}

/** Whether somebody could hold any share of the pool: manages a client, evaluates, or has brought somebody in. */
async function mightHoldAShare(profile: Profile): Promise<boolean> {
  if (canDoEvaluations(profile.roles, profile.does_evaluations)) return true;
  const supabase = await createClient();
  const [managed, referred, links] = await Promise.all([
    supabase.from("customers").select("id").eq("account_manager_id", profile.id).limit(1),
    supabase.from("jobs").select("id").eq("referred_by_profile_id", profile.id).limit(1),
    supabase.from("outreach_links").select("code").eq("profile_id", profile.id).limit(1),
  ]);
  // A lookup that failed is not a no: work the book out properly.
  if (managed.error || referred.error || links.error) return true;
  return (managed.data?.length ?? 0) + (referred.data?.length ?? 0) + (links.data?.length ?? 0) > 0;
}

export interface ManagerCommission {
  profileId: string;
  personName: string;
  summary: CommissionSummary;
  /** Owed on advances: paid back first out of their next commission. */
  advanceOwed?: number;
}

/** Everybody's book, for the Money page: account managers, evaluators and affiliates. */
export async function getCommissionByManager(profiles: Profile[]): Promise<ManagerCommission[]> {
  const [all, ctx] = await Promise.all([listJobsWithLocation(), loadPoolContext()]);
  const relevant = (all as JobWithCode[]).filter((j) => touches(j, ctx));
  const money = await loadMoney(relevant.map((j) => j.id));
  const shares = sharesByPerson(relevant, money, ctx);

  return profiles
    .filter((person) => shares.has(person.id))
    .map((person) => ({
      profileId: person.id,
      personName: person.full_name || person.email,
      summary: commissionFor(shares.get(person.id) ?? [], person.commission_pct),
    }))
    // Somebody with nothing on their book is not a row worth printing.
    .filter((b) => b.summary.lines.length > 0)
    .sort((a, b) => b.summary.earned - a.summary.earned);
}

/** One person's commission on one job. */
export interface JobCommission {
  line: CommissionLine;
  /** Whose share it is. */
  managerName: string;
  /** Whether the person looking at it is the one it is paid to. */
  mine: boolean;
  /** Every payment already recorded against it, to them. */
  payouts: { id: string; amount: number; paidAt: string; reference: string | null }[];
}

/**
 * The commission on one job, for the job's own page: a share per person.
 *
 * Somebody standing on a project wants to know what it is worth to them and
 * whether it has been paid, and going to the Money page to find out is a trip
 * nobody makes. Shown on the job, where the question is asked.
 *
 * Each person sees their own share. Whoever runs the money sees them all;
 * what a colleague earns is not everybody's business.
 */
export async function getJobCommission(jobId: string, viewer: Profile): Promise<JobCommission[]> {
  const supabase = await createClient();
  const [all, ctx] = await Promise.all([listJobsWithLocation(), loadPoolContext()]);
  const job = (all as JobWithCode[]).find((j) => j.id === jobId);
  if (!job) return [];

  const runsTheMoney = viewer.roles.includes("admin") || viewer.roles.includes("overhead");
  const money = await loadMoney([job.id]);
  const shares = [...sharesByPerson([job], money, ctx).entries()].filter(([id]) => runsTheMoney || id === viewer.id);
  if (shares.length === 0) return [];

  const payouts = (await safe(
    supabase
      .from("commission_payouts")
      .select("id, profile_id, amount, paid_at, reference")
      .eq("job_id", job.id)
      .order("paid_at", { ascending: false })
  )) as { id: string; profile_id: string; amount: number; paid_at: string; reference: string | null }[];

  return shares.flatMap(([profileId, inputs]) => {
    const person = ctx.people.get(profileId);
    const line = commissionFor(inputs, person?.pct ?? null).lines[0];
    if (!line) return [];
    return [
      {
        line,
        managerName: (person?.name ?? "Somebody").split(" ")[0],
        mine: profileId === viewer.id,
        payouts: payouts
          .filter((row) => row.profile_id === profileId)
          .map((row) => ({ id: row.id, amount: Number(row.amount) || 0, paidAt: row.paid_at, reference: row.reference })),
      },
    ];
  });
}

import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation, type JobWithLocation } from "@/lib/data/jobs";
import { isAccountManager } from "@/lib/affiliate-roles";
import {
  commissionFor,
  type CommissionJobInput,
  type CommissionLine,
  type CommissionSummary,
} from "@/lib/commission";
import type { Profile } from "@/types/domain";

async function safe<T>(query: PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  try {
    const { data } = await query;
    return data ?? [];
  } catch {
    return [];
  }
}

interface JobMoney {
  collected: Map<string, number>;
  contract: Map<string, number | null>;
  openTickets: Map<string, number>;
  /** Commission already handed over, per job. */
  paidOut: Map<string, number>;
  lastPaidAt: Map<string, string>;
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
async function loadMoney(jobIds: string[]): Promise<JobMoney> {
  const empty: JobMoney = {
    collected: new Map(),
    contract: new Map(),
    openTickets: new Map(),
    paidOut: new Map(),
    lastPaidAt: new Map(),
  };
  if (jobIds.length === 0) return empty;

  const supabase = await createClient();
  const [invoices, ledger, proposals, tickets, payouts, payments] = await Promise.all([
    safe(supabase.from("invoices").select("id, job_id, amount, status, paid_at").in("job_id", jobIds)),
    safe(
      supabase.from("ledger_entries").select("job_id, amount, direction").eq("direction", "in").in("job_id", jobIds)
    ),
    safe(supabase.from("job_proposals").select("job_id, total_cost").in("job_id", jobIds)),
    safe(supabase.from("job_tickets").select("job_id, status").in("job_id", jobIds)),
    safe(supabase.from("commission_payouts").select("job_id, amount, paid_at").in("job_id", jobIds)),
    // The payments table is where Stripe and the hand-recorded cheques both
    // land, and until now nothing here read it: commission was worked out
    // from invoices and the ledger, which were empty, while a hundred card
    // payments sat in a table this never opened.
    safe(
      supabase
        .from("payments")
        .select("job_id, amount_cents, surcharge_cents, invoice_id")
        .in("job_id", jobIds)
    ),
  ]);

  const collected = new Map<string, number>();
  const add = (jobId: string | null, amount: number) => {
    if (!jobId) return;
    collected.set(jobId, (collected.get(jobId) ?? 0) + amount);
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
  }[]) {
    add(row.job_id, (row.amount_cents - (row.surcharge_cents ?? 0)) / 100);
    if (row.invoice_id) coveredInvoices.add(row.invoice_id);
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
  }[]) {
    if (coveredInvoices.has(inv.id)) continue;
    if (inv.paid_at || inv.status === "paid") add(inv.job_id, Number(inv.amount) || 0);
  }
  for (const row of ledger as { job_id: string | null; amount: number }[]) {
    add(row.job_id, Number(row.amount) || 0);
  }

  const contract = new Map<string, number | null>(
    (proposals as { job_id: string; total_cost: number | null }[]).map((p) => [p.job_id, p.total_cost])
  );

  const openTickets = new Map<string, number>();
  for (const t of tickets as { job_id: string; status: string }[]) {
    // Resolved and closed tickets are the record of something already dealt
    // with. Only the ones somebody still owes a trip for hold a payout.
    if (t.status === "open" || t.status === "scheduled") {
      openTickets.set(t.job_id, (openTickets.get(t.job_id) ?? 0) + 1);
    }
  }

  // What has actually been handed over. Summed rather than flagged: a job
  // part paid and then collected on again owes the difference, and a flag
  // would say settled and be wrong.
  const paidOut = new Map<string, number>();
  const lastPaidAt = new Map<string, string>();
  for (const row of payouts as { job_id: string; amount: number; paid_at: string }[]) {
    paidOut.set(row.job_id, (paidOut.get(row.job_id) ?? 0) + (Number(row.amount) || 0));
    const seen = lastPaidAt.get(row.job_id);
    if (!seen || row.paid_at > seen) lastPaidAt.set(row.job_id, row.paid_at);
  }

  return { collected, contract, openTickets, paidOut, lastPaidAt };
}

function toInputs(jobs: JobWithLocation[], money: JobMoney): CommissionJobInput[] {
  return jobs.map((job) => ({
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
    paidOut: money.paidOut.get(job.id) ?? 0,
    lastPaidAt: money.lastPaidAt.get(job.id) ?? null,
  }));
}

/** One account manager's book — every job on a client they manage. */
export async function getCommissionFor(profile: Profile): Promise<CommissionSummary> {
  const all = await listJobsWithLocation();
  const mine = all.filter((j) => j.property.customer.account_manager_id === profile.id);
  if (mine.length === 0) return commissionFor([], profile.commission_pct);

  const money = await loadMoney(mine.map((j) => j.id));
  return commissionFor(toInputs(mine, money), profile.commission_pct);
}

export interface ManagerCommission {
  profileId: string;
  personName: string;
  summary: CommissionSummary;
}

/** Every account manager's book, for the Money page. */
export async function getCommissionByManager(profiles: Profile[]): Promise<ManagerCommission[]> {
  const managers = profiles.filter((p) => isAccountManager(p.roles));
  if (managers.length === 0) return [];

  const managerIds = new Set(managers.map((m) => m.id));
  const all = await listJobsWithLocation();
  const relevant = all.filter((j) => {
    const owner = j.property.customer.account_manager_id;
    return owner != null && managerIds.has(owner);
  });

  const money = await loadMoney(relevant.map((j) => j.id));

  return managers
    .map((manager) => ({
      profileId: manager.id,
      personName: manager.full_name || manager.email,
      summary: commissionFor(
        toInputs(
          relevant.filter((j) => j.property.customer.account_manager_id === manager.id),
          money
        ),
        manager.commission_pct
      ),
    }))
    // Somebody with nothing on their book is not a row worth printing.
    .filter((b) => b.summary.lines.length > 0)
    .sort((a, b) => b.summary.earned - a.summary.earned);
}

/** One job's commission, for the person whose commission it is. */
export interface JobCommission {
  line: CommissionLine;
  /** Whose book it sits on. */
  managerName: string;
  /** Whether the person looking at it is that manager. */
  mine: boolean;
  /** Every payment already recorded against it. */
  payouts: { id: string; amount: number; paidAt: string; reference: string | null }[];
}

/**
 * The commission on one job, for the job's own page.
 *
 * An account manager standing on a project wants to know what it is worth to
 * them and whether it has been paid, and going to the Money page to find out
 * is a trip nobody makes. Shown on the job, where the question is asked.
 *
 * Nothing here for somebody who neither manages the client nor runs the
 * money: what a colleague earns is not everybody's business.
 */
export async function getJobCommission(jobId: string, viewer: Profile): Promise<JobCommission | null> {
  const supabase = await createClient();
  const all = await listJobsWithLocation();
  const job = all.find((j) => j.id === jobId);
  const managerId = job?.property.customer.account_manager_id ?? null;
  if (!job || !managerId) return null;

  const mine = managerId === viewer.id;
  const runsTheMoney = viewer.roles.includes("admin") || viewer.roles.includes("overhead");
  if (!mine && !runsTheMoney) return null;

  const { data: manager } = await supabase
    .from("profiles")
    .select("id, full_name, email, commission_pct")
    .eq("id", managerId)
    .maybeSingle();
  if (!manager) return null;

  const money = await loadMoney([job.id]);
  const summary = commissionFor(toInputs([job], money), manager.commission_pct);
  const line = summary.lines[0];
  if (!line) return null;

  const payouts = await safe(
    supabase
      .from("commission_payouts")
      .select("id, amount, paid_at, reference")
      .eq("job_id", job.id)
      .order("paid_at", { ascending: false })
  );

  return {
    line,
    managerName: manager.full_name || manager.email,
    mine,
    payouts: (payouts as { id: string; amount: number; paid_at: string; reference: string | null }[]).map(
      (row) => ({
        id: row.id,
        amount: Number(row.amount) || 0,
        paidAt: row.paid_at,
        reference: row.reference,
      })
    ),
  };
}

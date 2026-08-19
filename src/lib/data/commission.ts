import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation, type JobWithLocation } from "@/lib/data/jobs";
import { isAccountManager } from "@/lib/affiliate-roles";
import { commissionFor, type CommissionJobInput, type CommissionSummary } from "@/lib/commission";
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
  const empty: JobMoney = { collected: new Map(), contract: new Map(), openTickets: new Map() };
  if (jobIds.length === 0) return empty;

  const supabase = await createClient();
  const [invoices, ledger, proposals, tickets] = await Promise.all([
    safe(supabase.from("invoices").select("job_id, amount, status, paid_at").in("job_id", jobIds)),
    safe(
      supabase.from("ledger_entries").select("job_id, amount, direction").eq("direction", "in").in("job_id", jobIds)
    ),
    safe(supabase.from("job_proposals").select("job_id, total_cost").in("job_id", jobIds)),
    safe(supabase.from("job_tickets").select("job_id, status").in("job_id", jobIds)),
  ]);

  const collected = new Map<string, number>();
  const add = (jobId: string | null, amount: number) => {
    if (!jobId) return;
    collected.set(jobId, (collected.get(jobId) ?? 0) + amount);
  };

  // A paid invoice is money. A sent one is a claim, and claims do not pay
  // commission.
  for (const inv of invoices as { job_id: string; amount: number; status: string; paid_at: string | null }[]) {
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

  return { collected, contract, openTickets };
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

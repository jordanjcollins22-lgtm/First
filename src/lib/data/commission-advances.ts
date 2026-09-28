import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { loadMoney } from "@/lib/data/commission";
import { DEFAULT_ACCOUNT_MANAGER_PCT } from "@/lib/commission";
import { advanceLimit, advanceRoom, isPending, paidInFull, type AdvanceStatus } from "@/lib/commission-advance";
import type { Profile } from "@/types/domain";

/**
 * Advances on commission: every one asked for, with where it stands; what
 * each account manager owes on them; and for an account manager, how much
 * more they could ask for.
 */

export interface AdvanceRow {
  id: string;
  profileId: string;
  person: string;
  /** Older advances were asked on a project; an advance now is on the account. */
  jobId: string | null;
  client: string | null;
  amount: number;
  reason: string | null;
  status: AdvanceStatus;
  requestedAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
}

export interface AdvanceProject {
  jobId: string;
  client: string;
  address: string;
  /** What an advance on it could still be, in dollars. */
  room: number;
}

/** Sold work: a project an advance can be asked on. */
const SOLD = new Set(["approved", "scheduled", "in_progress", "completed"]);

export async function listAdvances(filter: { profileId?: string } = {}): Promise<AdvanceRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("commission_advances")
    .select(
      "id, profile_id, job_id, amount, reason, status, requested_at, decided_at, decision_note, paid_at, method, reference, person:profiles!commission_advances_profile_id_fkey(full_name, email), job:jobs(property:properties(customer:customers(name)))"
    )
    .order("requested_at", { ascending: false })
    .limit(200);
  if (filter.profileId) query = query.eq("profile_id", filter.profileId);
  const { data, error } = await query;
  if (error) throw error;
  type Row = {
    id: string;
    profile_id: string;
    job_id: string | null;
    amount: number | string;
    reason: string | null;
    status: AdvanceStatus;
    requested_at: string;
    decided_at: string | null;
    decision_note: string | null;
    paid_at: string | null;
    method: string | null;
    reference: string | null;
    person: { full_name: string | null; email: string | null } | null;
    job: { property: { customer: { name: string | null } | null } | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    profileId: r.profile_id,
    person: (r.person?.full_name || r.person?.email || "Somebody").split(" ")[0],
    jobId: r.job_id,
    client: r.job?.property?.customer?.name ?? null,
    amount: Number(r.amount),
    reason: r.reason,
    status: r.status,
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
    decisionNote: r.decision_note,
    paidAt: r.paid_at,
    method: r.method,
    reference: r.reference,
  }));
}

/**
 * What each account manager owes on advances: every advance paid to them,
 * less the commission kept to pay them back.
 */
export async function advanceOwed(profileIds: string[]): Promise<Map<string, number>> {
  const owed = new Map<string, number>();
  if (profileIds.length === 0) return owed;
  const supabase = await createClient();
  const [{ data: paid }, { data: repaid }] = await Promise.all([
    supabase.from("commission_advances").select("profile_id, amount").eq("status", "paid").in("profile_id", profileIds),
    supabase.from("commission_payouts").select("profile_id, amount").eq("advance_repayment", true).in("profile_id", profileIds),
  ]);
  for (const a of paid ?? []) owed.set(a.profile_id, (owed.get(a.profile_id) ?? 0) + Number(a.amount));
  for (const r of repaid ?? []) owed.set(r.profile_id, (owed.get(r.profile_id) ?? 0) - Number(r.amount));
  for (const [id, n] of owed) owed.set(id, Math.max(0, Math.round(n * 100) / 100));
  return owed;
}

export interface AdvanceBook {
  /** Projects the client has paid in full, with the commission still to come on each. */
  projects: AdvanceProject[];
  /** Owed on advances already paid. */
  owed: number;
  /** Asked for, not paid yet. */
  pending: number;
  /** What can be asked for now. */
  limit: number;
  advances: AdvanceRow[];
}

/**
 * One account manager's advances: what they owe, what is waiting, and how
 * much more they could ask for -- the commission to come on sold work the
 * client has paid in full, less what they owe and have asked for.
 */
export async function advanceBook(profile: Pick<Profile, "id" | "commission_pct">): Promise<AdvanceBook> {
  const all = await listJobsWithLocation();
  const mine = all.filter((j) => j.property.customer.account_manager_id === profile.id && SOLD.has(j.status));
  const [money, advances, owedBy] = await Promise.all([
    loadMoney(mine.map((j) => j.id)),
    listAdvances({ profileId: profile.id }),
    advanceOwed([profile.id]),
  ]);
  const pct = profile.commission_pct ?? DEFAULT_ACCOUNT_MANAGER_PCT;
  const projects = mine
    // Paid in full on what the client handed over: a card payment recorded
    // with its fee taken out still paid the whole price.
    .filter((job) => paidInFull(money.contract.get(job.id) ?? null, money.paidByClient.get(job.id) ?? 0))
    .map((job) => ({
      jobId: job.id,
      client: job.property.customer.name,
      address: job.property.address,
      room: advanceRoom(
        { pct, contractValue: money.contract.get(job.id) ?? null, collected: money.collected.get(job.id) ?? 0, paidOut: money.paidOut.get(job.id) ?? 0 },
        0
      ),
    }))
    .filter((p) => p.room > 0)
    .sort((a, b) => b.room - a.room);
  const owed = owedBy.get(profile.id) ?? 0;
  const pending = advances.filter((a) => isPending(a.status)).reduce((sum, a) => sum + a.amount, 0);
  return { projects, owed, pending, limit: advanceLimit(projects.map((p) => p.room), owed, pending), advances };
}

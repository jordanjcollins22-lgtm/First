import { createClient } from "@/lib/supabase/server";
import { listJobsWithLocation } from "@/lib/data/jobs";
import { loadMoney } from "@/lib/data/commission";
import { DEFAULT_ACCOUNT_MANAGER_PCT } from "@/lib/commission";
import { advanceRoom, isPending, paidInFull, type AdvanceStatus } from "@/lib/commission-advance";
import type { Profile } from "@/types/domain";

/**
 * Advances on commission: every one asked for, with where it stands, and
 * for an account manager the projects they could ask on and how much.
 */

export interface AdvanceRow {
  id: string;
  profileId: string;
  person: string;
  jobId: string;
  client: string;
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
    job_id: string;
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
    client: r.job?.property?.customer?.name ?? "A project",
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
 * The projects this account manager could ask for an advance on -- sold
 * work on clients they manage, paid for in full by the client -- with how
 * much each could still be.
 */
export async function advanceProjects(profile: Pick<Profile, "id" | "commission_pct">): Promise<AdvanceProject[]> {
  const all = await listJobsWithLocation();
  const mine = all.filter((j) => j.property.customer.account_manager_id === profile.id && SOLD.has(j.status));
  if (mine.length === 0) return [];
  const [money, advances] = await Promise.all([loadMoney(mine.map((j) => j.id)), listAdvances({ profileId: profile.id })]);
  const pct = profile.commission_pct ?? DEFAULT_ACCOUNT_MANAGER_PCT;
  return mine
    .filter((job) => paidInFull(money.contract.get(job.id) ?? null, money.collected.get(job.id) ?? 0))
    .map((job) => {
      const pending = advances.filter((a) => a.jobId === job.id && isPending(a.status)).reduce((sum, a) => sum + a.amount, 0);
      return {
        jobId: job.id,
        client: job.property.customer.name,
        address: job.property.address,
        room: advanceRoom(
          { pct, contractValue: money.contract.get(job.id) ?? null, collected: money.collected.get(job.id) ?? 0, paidOut: money.paidOut.get(job.id) ?? 0 },
          pending
        ),
      };
    })
    .filter((p) => p.room > 0)
    .sort((a, b) => b.room - a.room);
}

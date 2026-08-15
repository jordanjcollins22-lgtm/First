import { createClient } from "@/lib/supabase/server";
import { listProfiles } from "@/lib/data/team";
import type { PayablePerson, TeamPayment, TeamPaymentWithPayee } from "@/types/domain";

/** Roles allowed to see and record everyone's pay. Mirrors the RLS policy in
 * migration 0074 — keep the two in step. */
export const PAYROLL_ROLES = ["admin", "overhead", "owner"];

export function canManagePayroll(roles: string[]): boolean {
  return roles.some((role) => PAYROLL_ROLES.includes(role));
}

function displayName(profile: { full_name: string | null; email: string }): string {
  return profile.full_name?.trim() || profile.email;
}

/** Everyone who could be paid, for the payee picker. Sorted by name so the
 * list doesn't reshuffle as people are added. */
export async function listPayablePeople(): Promise<PayablePerson[]> {
  const profiles = await listProfiles();
  return profiles
    .map((p) => ({
      id: p.id,
      name: displayName(p),
      payType: p.pay_type,
      ratePerHour: p.pay_rate_per_hour,
      commissionPct: p.commission_pct,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The payment ledger, newest first. RLS already narrows this: payroll roles
 * get the whole organization, everyone else gets only their own rows, so this
 * same function backs both the manager view and a person's own history.
 */
export async function listTeamPayments(): Promise<TeamPaymentWithPayee[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("team_payments")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  // Postgres `numeric` arrives over the wire as a string ("450.00"), so amount
  // and hours are coerced here — once, at the boundary — rather than leaving
  // every caller to remember. Without this, summing them concatenates.
  const payments = ((data ?? []) as unknown as TeamPayment[]).map((row) => ({
    ...row,
    amount: Number(row.amount) || 0,
    hours: row.hours == null ? null : Number(row.hours),
  }));
  if (payments.length === 0) return [];

  // Named separately rather than via an embedded join: profiles carries its
  // own RLS, and a blocked embed would silently null the whole row.
  const profiles = await listProfiles();
  const nameById = new Map(profiles.map((p) => [p.id, displayName(p)]));

  return payments.map((payment) => ({
    ...payment,
    payeeName: nameById.get(payment.profile_id) ?? "Former team member",
  }));
}

export interface PayrollTotals {
  paid: number;
  pending: number;
  paidThisMonth: number;
}

/** Sums for the header tiles. Done here rather than in the client so the
 * numbers can't drift from what the ledger actually holds. */
export function summarizePayments(payments: TeamPayment[]): PayrollTotals {
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  return payments.reduce<PayrollTotals>(
    (totals, payment) => {
      const amount = Number(payment.amount) || 0;
      if (payment.status === "paid") {
        totals.paid += amount;
        if (payment.paid_at?.startsWith(monthPrefix)) totals.paidThisMonth += amount;
      } else {
        totals.pending += amount;
      }
      return totals;
    },
    { paid: 0, pending: 0, paidThisMonth: 0 }
  );
}

export interface PersonTotal {
  profileId: string;
  name: string;
  paid: number;
  pending: number;
}

/** Per-person roll-up, biggest outstanding balance first — the useful order
 * when the question is "who am I behind on paying". */
export function totalsByPerson(payments: TeamPaymentWithPayee[]): PersonTotal[] {
  const byPerson = new Map<string, PersonTotal>();
  for (const payment of payments) {
    const existing = byPerson.get(payment.profile_id) ?? {
      profileId: payment.profile_id,
      name: payment.payeeName,
      paid: 0,
      pending: 0,
    };
    const amount = Number(payment.amount) || 0;
    if (payment.status === "paid") existing.paid += amount;
    else existing.pending += amount;
    byPerson.set(payment.profile_id, existing);
  }
  return [...byPerson.values()].sort((a, b) => b.pending - a.pending || a.name.localeCompare(b.name));
}

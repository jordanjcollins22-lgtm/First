import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * What a client has already paid towards a job, in cents: every payment
 * recorded against it, a first half by invoice, a deposit, cash collected.
 * The card fee is kept apart on the payment row, so only the work counts.
 *
 * The pay page asks for the total less this. It used to ask for the whole
 * total, so a client who had paid half by invoice was asked for all of it.
 */
export async function paidOnJobCents(admin: ReturnType<typeof createAdminClient>, jobId: string): Promise<number> {
  const { data } = await admin.from("payments").select("amount_cents").eq("job_id", jobId);
  return ((data ?? []) as { amount_cents: number | null }[]).reduce((sum, row) => sum + Math.max(0, Number(row.amount_cents) || 0), 0);
}

/** The balance left on a job: the agreed total less what has been paid, never below zero. */
export function balanceCents(totalCents: number, paidCents: number): number {
  return Math.max(0, Math.round(totalCents) - Math.max(0, Math.round(paidCents)));
}

import { randomBytes } from "node:crypto";

import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * A tip paid with the bill, on the job's tip row: the same row a thank-you
 * link would have used, so a job has one tip whichever way it came. Never on
 * the payment for the work, so it is not counted as the price of the job.
 */
export async function recordTipWithPayment(admin: ReturnType<typeof createAdminClient>, jobId: string, tipCents: number): Promise<void> {
  if (!(tipCents > 0)) return;
  const paidAt = new Date().toISOString();
  const { data: existing } = await admin.from("job_tips").select("id, status").eq("job_id", jobId).maybeSingle();
  if (existing) {
    if (existing.status === "paid") return;
    await admin.from("job_tips").update({ status: "paid", amount_cents: tipCents, paid_at: paidAt }).eq("id", existing.id);
    return;
  }
  const { data: proposal } = await admin.from("job_proposals").select("organization_id, total_cost").eq("job_id", jobId).maybeSingle();
  if (!proposal) return;
  await admin.from("job_tips").insert({
    organization_id: proposal.organization_id,
    job_id: jobId,
    token: randomBytes(16).toString("base64url"),
    status: "paid",
    amount_cents: tipCents,
    job_total_cents: proposal.total_cost != null ? Math.round(Number(proposal.total_cost) * 100) : null,
    paid_at: paidAt,
  });
}

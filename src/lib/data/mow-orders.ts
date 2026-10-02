import { createClient } from "@/lib/supabase/server";
import { quickMowStage, type QuickMowStage } from "@/lib/quick-mow-pipeline";

/** A quick mow order as the team's call list shows it. */
export interface MowOrderRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  tier: string | null;
  tierMoved: boolean;
  lawnSqft: number | null;
  amountCents: number | null;
  regularCents: number | null;
  status: string;
  paidAt: string | null;
  createdAt: string;
  calledAt: string | null;
  jobId: string | null;
  jobNumber: number | null;
  referralCode: string | null;
  /** Where it sits on the quick mow pipeline. */
  stage: QuickMowStage;
  /** The first visit on the calendar, when there is one. */
  visitOn: string | null;
}

/** The business's quick mow orders: paid ones to call, and checkouts started but not finished. Read under the viewer's own sign-in. */
export async function listMowOrders(): Promise<MowOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mow_orders")
    .select(
      "id, name, phone, email, address, tier, tier_moved, lawn_sqft, amount_cents, regular_cents, status, paid_at, created_at, called_at, job_id, referral_code, " +
        "job:jobs(status, job_number, job_work_sessions(status, starts_on))"
    )
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  type Row = {
    id: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    tier: string | null;
    tier_moved: boolean;
    lawn_sqft: number | null;
    amount_cents: number | null;
    regular_cents: number | null;
    status: string;
    paid_at: string | null;
    created_at: string;
    called_at: string | null;
    job_id: string | null;
    referral_code: string | null;
    job: { status: string; job_number: number | null; job_work_sessions: { status: string; starts_on: string }[] } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const visits = (r.job?.job_work_sessions ?? []).filter((v) => v.status !== "cancelled");
    const next = [...visits].sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
    return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    address: r.address,
    tier: r.tier,
    tierMoved: r.tier_moved,
    lawnSqft: r.lawn_sqft,
    amountCents: r.amount_cents,
    regularCents: r.regular_cents,
    status: r.status,
    paidAt: r.paid_at,
    createdAt: r.created_at,
    calledAt: r.called_at,
    jobId: r.job_id,
    jobNumber: r.job?.job_number ?? null,
    referralCode: r.referral_code,
    stage: quickMowStage({ orderStatus: r.status, calledAt: r.called_at, jobStatus: r.job?.status ?? null, visits }),
    visitOn: next?.starts_on ?? null,
    };
  });
}

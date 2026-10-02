import { createClient } from "@/lib/supabase/server";

/** A quick mow order as the team's call list shows it. */
export interface MowOrderRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  tier: string;
  tierMoved: boolean;
  lawnSqft: number | null;
  amountCents: number;
  regularCents: number;
  status: string;
  paidAt: string | null;
  createdAt: string;
  calledAt: string | null;
  jobId: string | null;
  referralCode: string | null;
}

/** The business's quick mow orders: paid ones to call, and checkouts started but not finished. Read under the viewer's own sign-in. */
export async function listMowOrders(): Promise<MowOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mow_orders")
    .select("id, name, phone, email, address, tier, tier_moved, lawn_sqft, amount_cents, regular_cents, status, paid_at, created_at, called_at, job_id, referral_code")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw error;
  return (data ?? []).map((r) => ({
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
    referralCode: r.referral_code,
  }));
}

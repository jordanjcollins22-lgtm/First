import { createClient } from "@/lib/supabase/server";
import { isMissingTable } from "@/lib/setup-errors";

export interface FlyerBookingRow {
  id: string;
  businessName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  imageUrl: string | null;
  status: string;
  slot: number | null;
  amountCents: number | null;
  paidAt: string | null;
  createdAt: string;
}

export interface FlyerRunRow {
  id: string;
  name: string;
  mailsOn: string | null;
  flyerCount: number;
  spotPriceCents: number;
  status: string;
  bookings: FlyerBookingRow[];
  /** Spots actually paid for. */
  sold: number;
  /** Money in, in cents. */
  takenCents: number;
}

/**
 * Every run and who is on it.
 *
 * Two queries and a group, rather than one per run. The artwork URL is
 * resolved here so the office can see what an advertiser actually sent
 * without opening a bucket.
 */
export async function listFlyerRuns(): Promise<FlyerRunRow[]> {
  const supabase = await createClient();

  const { data: runs, error } = await supabase
    .from("flyer_runs")
    .select("id, name, mails_on, flyer_count, spot_price_cents, status")
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  const runRows = (runs ?? []) as {
    id: string;
    name: string;
    mails_on: string | null;
    flyer_count: number;
    spot_price_cents: number;
    status: string;
  }[];
  if (runRows.length === 0) return [];

  const { data: bookings } = await supabase
    .from("flyer_bookings")
    .select(
      "id, run_id, business_name, contact_name, email, phone, image_path, status, slot, amount_cents, paid_at, created_at"
    )
    .in(
      "run_id",
      runRows.map((r) => r.id)
    )
    .order("created_at", { ascending: false });

  const byRun = new Map<string, FlyerBookingRow[]>();
  for (const row of ((bookings ?? []) as {
    id: string;
    run_id: string;
    business_name: string;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
    image_path: string | null;
    status: string;
    slot: number | null;
    amount_cents: number | null;
    paid_at: string | null;
    created_at: string;
  }[])) {
    const url = row.image_path
      ? supabase.storage.from("flyer-ads").getPublicUrl(row.image_path).data.publicUrl
      : null;
    const list = byRun.get(row.run_id) ?? [];
    list.push({
      id: row.id,
      businessName: row.business_name,
      contactName: row.contact_name,
      email: row.email,
      phone: row.phone,
      imageUrl: url,
      status: row.status,
      slot: row.slot,
      amountCents: row.amount_cents,
      paidAt: row.paid_at,
      createdAt: row.created_at,
    });
    byRun.set(row.run_id, list);
  }

  return runRows.map((run) => {
    const list = byRun.get(run.id) ?? [];
    // Paid and placed only. A draft somebody abandoned is not revenue, and
    // counting it would show a run as full while it is empty.
    const paid = list.filter((b) => b.status === "paid" || b.status === "placed");
    return {
      id: run.id,
      name: run.name,
      mailsOn: run.mails_on,
      flyerCount: run.flyer_count,
      spotPriceCents: run.spot_price_cents,
      status: run.status,
      bookings: list,
      sold: paid.length,
      takenCents: paid.reduce((sum, b) => sum + (b.amountCents ?? 0), 0),
    };
  });
}

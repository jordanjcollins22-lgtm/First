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
  /** The day they picked when they paid. */
  mowDay: string | null;
  welcomeSentAt: string | null;
}

/** The business's quick mow orders: paid ones to call, and checkouts started but not finished. Read under the viewer's own sign-in. */
export async function listMowOrders(): Promise<MowOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("mow_orders")
    .select(
      "id, name, phone, email, address, tier, tier_moved, lawn_sqft, amount_cents, regular_cents, status, paid_at, created_at, called_at, job_id, referral_code, mow_day, welcome_sent_at, " +
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
    mow_day: string | null;
    welcome_sent_at: string | null;
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
    mowDay: r.mow_day,
    welcomeSentAt: r.welcome_sent_at,
    };
  });
}

export interface MowFunnelData {
  clicks: number;
  checks: { inArea: boolean | null; referralCode: string | null }[];
  alertsOn: boolean;
  mowsPerDay: number;
  /** Whether a Meta pixel and token are set. Only whether, never what. */
  metaConnected: boolean;
}

/** What the scoreboard counts beyond the orders: link clicks, address checks, and the settings. */
export async function getMowFunnelData(sinceIso: string): Promise<MowFunnelData> {
  const supabase = await createClient();
  const [{ data: links }, { data: checks }, { data: org }] = await Promise.all([
    supabase.from("outreach_links").select("id").eq("destination", "/mow"),
    supabase.from("mow_area_checks").select("in_area, referral_code").gte("created_at", sinceIso).limit(5000),
    supabase.from("organizations").select("quick_mow_alerts, mows_per_day").limit(1).maybeSingle(),
  ]);
  const ids = (links ?? []).map((l) => l.id);
  const { count } = ids.length
    ? await supabase.from("outreach_clicks").select("id", { count: "exact", head: true }).in("link_id", ids).gte("clicked_at", sinceIso)
    : { count: 0 };
  return {
    clicks: count ?? 0,
    checks: (checks ?? []).map((c) => ({ inArea: c.in_area, referralCode: c.referral_code })),
    alertsOn: Boolean(org?.quick_mow_alerts),
    mowsPerDay: org?.mows_per_day ?? 18,
    metaConnected: Boolean(process.env.META_PIXEL_ID && process.env.META_CAPI_TOKEN),
  };
}

/** The period's start, for the scoreboard: the last 7 or 30 days, or all time. */
export function periodStart(days: number | null): string {
  return days ? new Date(Date.now() - days * 86_400_000).toISOString() : "2000-01-01T00:00:00Z";
}

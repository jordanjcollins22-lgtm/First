import { createClient } from "@/lib/supabase/server";
import { listProfiles } from "@/lib/data/team";
import { totalLedger, type LedgerTotals } from "@/lib/ledger";
import type { LedgerEntry, Profile, TeamPayment } from "@/types/domain";
import { getOverhead } from "@/lib/data/overhead";
import { getPerDiem, type PerDiemBoard } from "@/lib/data/per-diem";
import type { OverheadBreakdown } from "@/lib/overhead";
import { tallyTips, type TipRecord, type TipTotals } from "@/lib/tips";
import { quotedShape, type QuotedShape } from "@/lib/commission-forecast";
import { DEFAULT_ACCOUNT_MANAGER_PCT } from "@/lib/commission";

export interface TeamPaymentWithPerson extends TeamPayment {
  personName: string;
  payType: Profile["pay_type"];
}

export interface ExternalPayment {
  id: string;
  jobId: string;
  amount: number;
  status: string;
  sentAt: string | null;
  paidAt: string | null;
  hostedInvoiceUrl: string | null;
  customerName: string;
  address: string;
}

/** A ledger row with the job it belongs to already resolved, so the list can
 * show the address without a second lookup per row. */
export interface LedgerEntryWithJob extends LedgerEntry {
  jobName: string | null;
  jobAddress: string | null;
}

export interface RevenueSummary {
  /** Invoices actually paid — money in. */
  collected: number;
  /** Invoiced and still open — money owed to us. */
  outstanding: number;
  /** Team payments already paid out. */
  paidOut: number;
  /** Team payments recorded but not yet paid — money we owe. */
  owedToTeam: number;
  /** Recurring overhead, per month, worked out from the transactions. */
  overhead: number;
  /** Cash taken outside Stripe — the cash-and-check half of the business. */
  ledgerIn: number;
  /** Materials, subs, fuel and the rest. */
  ledgerOut: number;
  /**
   * Everything that actually came in, minus everything that actually went out.
   *
   * Deliberately cash, not accrual: an unpaid invoice is not money, and a
   * number that counts it as money is the one that gets a business into
   * trouble. Outstanding is reported separately so it isn't lost.
   */
  net: number;
}

export interface PaymentsData {
  internal: TeamPaymentWithPerson[];
  external: ExternalPayment[];
  ledger: LedgerEntryWithJob[];
  ledgerTotals: LedgerTotals;
  /** Worked out from the bank, grouped. Nothing here is typed in. */
  overhead: OverheadBreakdown;
  /** The same figure as what a day of work has to earn, which is what a quote
   * needs. Null when there is nothing to spread yet. */
  perDiem: PerDiemBoard | null;
  /**
   * What clients have left for the crew.
   *
   * Kept apart from revenue on purpose. A tip is not money the business
   * earned on the work, and adding it to the collected figure would flatter
   * the margin and pay commission on somebody else's thank-you.
   */
  tips: TipTotals;
  /**
   * What jobs are quoted at.
   *
   * Only worth showing while nothing has been collected. Commission is paid
   * on money that arrived, and a business whose first invoice has not gone out
   * still deserves an answer to "what does a sale cost me in commission".
   */
  quoted: QuotedShape;
  revenue: RevenueSummary;
  team: Profile[];
  /** Jobs a ledger entry can be filed against. Open work only — filing a cost
   * against a job finished two years ago is nearly always a mis-click. */
  jobOptions: { id: string; label: string }[];
}

function sum(values: (number | null | undefined)[]): number {
  return Math.round(values.reduce<number>((total, v) => total + (v ?? 0), 0) * 100) / 100;
}

/**
 * Everything the payments screen shows, in one pass.
 *
 * Deliberately unfiltered by date: the business is small enough that the whole
 * history is a short list, and a period filter that hides a missed payment is
 * worse than a longer page.
 */
export async function getPaymentsData(): Promise<PaymentsData> {
  const supabase = await createClient();

  const [
    team,
    paymentsResult,
    invoicesResult,
    ledgerResult,
    jobsResult,
    overhead,
    perDiem,
    tips,
    quoted,
  ] = await Promise.all([
    listProfiles(),
    supabase
      .from("team_payments")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("id, job_id, amount, status, sent_at, paid_at, hosted_invoice_url, jobs(property_id, properties(address, customers(name)))")
      .order("created_at", { ascending: false }),
    supabase
      .from("ledger_entries")
      .select("*, jobs(name, properties(address))")
      .order("occurred_on", { ascending: false }),
    supabase
      .from("jobs")
      .select("id, name, properties(address)")
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(200),
    // Never typed in. Read from the same transactions the Subscriptions screen
    // reads, through a per-request cache, so the two can never disagree about
    // what the business costs to keep open.
    getOverhead().catch(() => ({
      groups: [],
      monthly: 0,
      yearly: 0,
      variableShare: 0,
    })),
    // What that same figure comes to per day and per crew-hour, which is the
    // form a quote can use.
    getPerDiem().catch(() => null),
    // Empty until migration 0242 runs.
    safeTips(supabase),
    safeQuotes(supabase),
  ]);

  const namesById = new Map(team.map((p) => [p.id, p.full_name || p.email]));
  const payTypesById = new Map(team.map((p) => [p.id, p.pay_type]));

  const internal: TeamPaymentWithPerson[] = ((paymentsResult.data ?? []) as unknown as TeamPayment[]).map((p) => ({
    ...p,
    personName: namesById.get(p.profile_id) ?? "Someone",
    payType: payTypesById.get(p.profile_id) ?? "hourly",
  }));

  const external: ExternalPayment[] = (
    (invoicesResult.data ?? []) as unknown as {
      id: string;
      job_id: string;
      amount: number;
      status: string;
      sent_at: string | null;
      paid_at: string | null;
      hosted_invoice_url: string | null;
      jobs: { properties: { address: string; customers: { name: string } | null } | null } | null;
    }[]
  ).map((inv) => ({
    id: inv.id,
    jobId: inv.job_id,
    amount: Number(inv.amount),
    status: inv.status,
    sentAt: inv.sent_at,
    paidAt: inv.paid_at,
    hostedInvoiceUrl: inv.hosted_invoice_url,
    customerName: inv.jobs?.properties?.customers?.name ?? "Client",
    address: inv.jobs?.properties?.address ?? "",
  }));

  const ledger: LedgerEntryWithJob[] = (
    (ledgerResult.data ?? []) as unknown as (LedgerEntry & {
      jobs: { name: string; properties: { address: string } | null } | null;
    })[]
  ).map((row) => ({
    ...row,
    amount: Number(row.amount),
    jobName: row.jobs?.name ?? null,
    jobAddress: row.jobs?.properties?.address ?? null,
  }));

  const ledgerTotals = totalLedger(ledger);

  const jobOptions = (
    (jobsResult.data ?? []) as unknown as { id: string; name: string; properties: { address: string } | null }[]
  ).map((j) => ({ id: j.id, label: j.properties?.address ? `${j.name} — ${j.properties.address}` : j.name }));

  const collected = sum(external.filter((e) => e.status === "paid").map((e) => e.amount));
  const outstanding = sum(external.filter((e) => e.status === "open").map((e) => e.amount));
  const paidOut = sum(internal.filter((p) => p.status === "paid").map((p) => Number(p.amount)));
  const owedToTeam = sum(internal.filter((p) => p.status === "pending").map((p) => Number(p.amount)));


  return {
    internal,
    external,
    ledger,
    ledgerTotals,
    overhead,
    perDiem,
    tips,
    quoted,
    revenue: {
      collected,
      outstanding,
      paidOut,
      owedToTeam,
      overhead: overhead.monthly,
      ledgerIn: ledgerTotals.in,
      ledgerOut: ledgerTotals.out,
      net:
        Math.round(
          (collected + ledgerTotals.in - paidOut - ledgerTotals.out - overhead.monthly) * 100
        ) / 100,
    },
    team,
    jobOptions,
  };
}

/**
 * What clients have left for the crew.
 *
 * Its own read rather than part of the ledger, because a tip is not job
 * revenue and must never be summed with it: adding it to what was collected
 * would flatter the margin and pay an account manager commission on somebody
 * else's thank-you.
 */
async function safeTips(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<TipTotals> {
  try {
    const { data } = await supabase.from("job_tips").select("status, amount_cents, paid_at");
    const rows: TipRecord[] = (data ?? []).map((row) => ({
      status: row.status as TipRecord["status"],
      amountCents: row.amount_cents,
      paidAt: row.paid_at,
    }));
    return tallyTips(rows);
  } catch {
    return tallyTips([]);
  }
}

/**
 * What the quotes say, for a business with nothing collected yet.
 *
 * A ceiling rather than a forecast: jobs get trimmed and discounted, and the
 * money that arrives is always less than the money that was quoted. Shown
 * because the alternative is showing nothing, which is the less useful lie.
 */
async function safeQuotes(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<QuotedShape> {
  try {
    const { data } = await supabase.from("job_proposals").select("total_cost");
    return quotedShape(
      (data ?? []).map((row) => Number(row.total_cost) || 0),
      DEFAULT_ACCOUNT_MANAGER_PCT
    );
  } catch {
    return quotedShape([], DEFAULT_ACCOUNT_MANAGER_PCT);
  }
}

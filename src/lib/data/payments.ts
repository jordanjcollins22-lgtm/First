import { createClient } from "@/lib/supabase/server";
import { listProfiles } from "@/lib/data/team";
import type { Profile, TeamPayment } from "@/types/domain";

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

export interface RevenueSummary {
  /** Invoices actually paid — money in. */
  collected: number;
  /** Invoiced and still open — money owed to us. */
  outstanding: number;
  /** Team payments already paid out. */
  paidOut: number;
  /** Team payments recorded but not yet paid — money we owe. */
  owedToTeam: number;
  /** Recurring overhead on the books. */
  overhead: number;
  /** collected − paidOut − overhead. Cash actually left, not accrual profit. */
  net: number;
}

export interface PaymentsData {
  internal: TeamPaymentWithPerson[];
  external: ExternalPayment[];
  revenue: RevenueSummary;
  team: Profile[];
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

  const [team, paymentsResult, invoicesResult, overheadResult] = await Promise.all([
    listProfiles(),
    supabase
      .from("team_payments")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("invoices")
      .select("id, job_id, amount, status, sent_at, paid_at, hosted_invoice_url, jobs(property_id, properties(address, customers(name)))")
      .order("created_at", { ascending: false }),
    supabase.from("overhead_expenses").select("amount"),
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

  const collected = sum(external.filter((e) => e.status === "paid").map((e) => e.amount));
  const outstanding = sum(external.filter((e) => e.status === "open").map((e) => e.amount));
  const paidOut = sum(internal.filter((p) => p.status === "paid").map((p) => Number(p.amount)));
  const owedToTeam = sum(internal.filter((p) => p.status === "pending").map((p) => Number(p.amount)));
  const overhead = sum(((overheadResult.data ?? []) as { amount: number }[]).map((o) => Number(o.amount)));

  return {
    internal,
    external,
    revenue: {
      collected,
      outstanding,
      paidOut,
      owedToTeam,
      overhead,
      net: Math.round((collected - paidOut - overhead) * 100) / 100,
    },
    team,
  };
}

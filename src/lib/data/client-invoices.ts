import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { ClientInvoice, InvoicePlan } from "@/lib/client-invoices";
import type { BankedRow, BilledRow } from "@/lib/accounting-reconcile";

interface InvoiceQueryRow {
  id: string;
  customer_id: string;
  file_path: string | null;
  file_name: string | null;
  title: string | null;
  scope_html: string | null;
  source_status: string | null;
  invoice_number: string | null;
  amount: number | null;
  issued_on: string | null;
  due_on: string | null;
  paid_on: string | null;
  notes: string | null;
  customers: { name: string } | null;
}

/** A page of invoices. Bounded on purpose: a list of every invoice the
 * business has ever raised is not a thing anybody reads, and it is not a
 * thing worth shipping to a phone either. */
export const PAGE_SIZE = 50;

const COLUMNS =
  "id, customer_id, file_path, file_name, title, invoice_number, amount, issued_on, due_on, paid_on, notes, scope_html, source_status, customers(name)";

function toInvoice(r: InvoiceQueryRow): ClientInvoice {
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customers?.name ?? null,
    filePath: r.file_path,
    fileName: r.file_name,
    title: r.title,
    scopeHtml: r.scope_html,
    sourceStatus: r.source_status,
    invoiceNumber: r.invoice_number,
    amount: r.amount,
    issuedOn: r.issued_on,
    dueOn: r.due_on,
    paidOn: r.paid_on,
    notes: r.notes,
  };
}

/**
 * The plans settling these invoices, and what has been paid against each.
 *
 * Two reads for the whole page rather than two per invoice: the alternative
 * is a query per card, which is fine at three invoices and a stall at fifty.
 * A failure here is not fatal — the invoices still list, they just fall back
 * to their own due dates.
 */
async function plansForInvoices(invoiceIds: string[]): Promise<Map<string, InvoicePlan>> {
  const byInvoice = new Map<string, InvoicePlan>();
  if (invoiceIds.length === 0) return byInvoice;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_plans")
    .select(
      "id, invoice_id, kind, total_cents, status, payment_plan_instalments(id, number, amount_cents, due_on, is_deposit, status)"
    )
    .in("invoice_id", invoiceIds);

  if (error) {
    console.error("Loading invoice payment plans failed:", error);
    return byInvoice;
  }

  const rows = (data ?? []) as unknown as {
    id: string;
    invoice_id: string | null;
    kind: string;
    total_cents: number;
    status: string;
    payment_plan_instalments: {
      id: string;
      number: number;
      amount_cents: number;
      due_on: string;
      is_deposit: boolean;
      status: string;
    }[];
  }[];

  const { data: paidRows } = await supabase
    .from("payments")
    .select("plan_id, amount_cents")
    .in("plan_id", rows.length > 0 ? rows.map((r) => r.id) : ["none"]);

  const paidByPlan = new Map<string, number>();
  for (const row of (paidRows ?? []) as { plan_id: string | null; amount_cents: number }[]) {
    if (!row.plan_id) continue;
    paidByPlan.set(row.plan_id, (paidByPlan.get(row.plan_id) ?? 0) + Number(row.amount_cents));
  }

  for (const row of rows) {
    if (!row.invoice_id) continue;
    byInvoice.set(row.invoice_id, {
      id: row.id,
      kind: row.kind,
      totalCents: Number(row.total_cents),
      paidCents: paidByPlan.get(row.id) ?? 0,
      status: row.status as InvoicePlan["status"],
      schedule: [...(row.payment_plan_instalments ?? [])]
        .sort((a, b) => a.number - b.number)
        .map((item) => ({
          id: item.id,
          number: item.number,
          amountCents: Number(item.amount_cents),
          dueOn: item.due_on,
          isDeposit: item.is_deposit,
          status: item.status as InvoicePlan["schedule"][number]["status"],
        })),
    });
  }

  return byInvoice;
}

/**
 * What has been paid against each of these invoices.
 *
 * One read for the whole page rather than one per card. A failure is not
 * fatal: the invoices still list, they just fall back to what was said about
 * them rather than what arrived.
 */
async function paymentsForInvoices(
  invoiceIds: string[]
): Promise<Map<string, { cents: number; lastOn: string | null }>> {
  const byInvoice = new Map<string, { cents: number; lastOn: string | null }>();
  if (invoiceIds.length === 0) return byInvoice;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select("invoice_id, amount_cents, surcharge_cents, received_at")
    .in("invoice_id", invoiceIds);

  if (error) {
    console.error("Loading payments against invoices failed:", error);
    return byInvoice;
  }

  for (const row of (data ?? []) as unknown as {
    invoice_id: string | null;
    amount_cents: number;
    surcharge_cents: number | null;
    received_at: string | null;
  }[]) {
    if (!row.invoice_id) continue;
    const found = byInvoice.get(row.invoice_id) ?? { cents: 0, lastOn: null };
    // Net of the card fee. A surcharge is money collected to cover a cost,
    // not money against the bill, and counting it would settle an invoice
    // three and a half percent early.
    found.cents += Number(row.amount_cents) - Number(row.surcharge_cents ?? 0);
    const on = row.received_at?.slice(0, 10) ?? null;
    if (on && (!found.lastOn || on > found.lastOn)) found.lastOn = on;
    byInvoice.set(row.invoice_id, found);
  }

  return byInvoice;
}

export interface InvoicePage {
  invoices: ClientInvoice[];
  /** Whether asking for the next page would return anything. */
  more: boolean;
}

/**
 * The most recent invoices, newest first.
 *
 * A page at a time. The urgency ordering happens on what came back rather
 * than in the query, because "overdue" is worked out from today's date and
 * asking the database to sort by a thing it does not store would mean storing
 * it.
 */
export async function listInvoices(page = 0): Promise<InvoicePage> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const from = page * PAGE_SIZE;
  // One more than a page, purely to find out whether there is another one.
  const { data, error } = await supabase
    .from("client_invoices")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .order("issued_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE);

  if (error) throw error;

  const rows = (data ?? []) as unknown as InvoiceQueryRow[];
  const invoices = rows.slice(0, PAGE_SIZE).map(toInvoice);
  const ids = invoices.map((i) => i.id);
  const [plans, paid] = await Promise.all([plansForInvoices(ids), paymentsForInvoices(ids)]);

  return {
    invoices: invoices.map((i) => ({
      ...i,
      plan: plans.get(i.id) ?? null,
      paidCents: paid.get(i.id)?.cents ?? 0,
      lastPaidOn: paid.get(i.id)?.lastOn ?? null,
    })),
    more: rows.length > PAGE_SIZE,
  };
}

/** Every invoice on one contact. Bounded by how many bills one person has
 * had, which is a number that stays small. */
export async function listInvoicesForCustomer(customerId: string): Promise<ClientInvoice[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const { data, error } = await supabase
    .from("client_invoices")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .order("issued_on", { ascending: false, nullsFirst: false });

  if (error) throw error;
  const invoices = ((data ?? []) as unknown as InvoiceQueryRow[]).map(toInvoice);
  const ids = invoices.map((i) => i.id);
  const [plans, paid] = await Promise.all([plansForInvoices(ids), paymentsForInvoices(ids)]);
  return invoices.map((i) => ({
    ...i,
    plan: plans.get(i.id) ?? null,
    paidCents: paid.get(i.id)?.cents ?? 0,
    lastPaidOn: paid.get(i.id)?.lastOn ?? null,
  }));
}

/**
 * Everything billed and everything banked, for the reconciliation.
 *
 * Two narrow reads rather than the full rows: this feeds a set of totals, and
 * shipping every invoice and every payment to add four numbers up is how a
 * summary screen becomes the slowest page in the app.
 */
export async function getReconciliationRows(): Promise<{
  billed: BilledRow[];
  banked: BankedRow[];
}> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const [invoices, payments] = await Promise.all([
    supabase
      .from("client_invoices")
      .select("customer_id, amount, paid_on, source_status, customers(name)")
      .eq("organization_id", organizationId),
    supabase
      .from("payments")
      .select("customer_id, amount_cents, surcharge_cents")
      .eq("organization_id", organizationId),
  ]);

  if (invoices.error) throw invoices.error;
  if (payments.error) throw payments.error;

  const billed: BilledRow[] = (
    (invoices.data ?? []) as unknown as {
      customer_id: string;
      amount: number | null;
      paid_on: string | null;
      source_status: string | null;
      customers: { name: string } | null;
    }[]
  ).map((r) => ({
    customerId: r.customer_id,
    customerName: r.customers?.name ?? null,
    amountCents: r.amount == null ? 0 : Math.round(r.amount * 100),
    settled: Boolean(r.paid_on) || (r.source_status ?? "").toLowerCase() === "paid",
  }));

  // Net of the card surcharge. A client who paid a $4,520 bill by card sent
  // $4,678.20, and counting the fee as money against the bill would show them
  // as having overpaid while quietly inflating what the work earned.
  const banked: BankedRow[] = (
    (payments.data ?? []) as unknown as {
      customer_id: string | null;
      amount_cents: number;
      surcharge_cents: number | null;
    }[]
  ).map((r) => ({
    customerId: r.customer_id,
    amountCents: Number(r.amount_cents) - Number(r.surcharge_cents ?? 0),
  }));

  return { billed, banked };
}

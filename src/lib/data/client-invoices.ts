import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { ClientInvoice } from "@/lib/client-invoices";

interface InvoiceQueryRow {
  id: string;
  customer_id: string;
  file_path: string;
  file_name: string;
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
  "id, customer_id, file_path, file_name, invoice_number, amount, issued_on, due_on, paid_on, notes, customers(name)";

function toInvoice(r: InvoiceQueryRow): ClientInvoice {
  return {
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customers?.name ?? null,
    filePath: r.file_path,
    fileName: r.file_name,
    invoiceNumber: r.invoice_number,
    amount: r.amount,
    issuedOn: r.issued_on,
    dueOn: r.due_on,
    paidOn: r.paid_on,
    notes: r.notes,
  };
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
  return {
    invoices: rows.slice(0, PAGE_SIZE).map(toInvoice),
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
  return ((data ?? []) as unknown as InvoiceQueryRow[]).map(toInvoice);
}

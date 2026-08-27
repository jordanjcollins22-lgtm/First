import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import {
  contactsWithNoProject,
  groupPayments,
  summarise,
  suggestedProjectName,
  type GroupSummary,
  type PaymentGroup,
  type PaymentRow,
} from "@/lib/payment-grouping";

/** One payment, with enough around it to show a row without a second query. */
export interface ReceivedPayment {
  id: string;
  customerId: string | null;
  customerName: string | null;
  jobId: string | null;
  jobName: string | null;
  amountCents: number;
  method: string;
  receivedAt: string;
  note: string | null;
  stripeInvoiceId: string | null;
}

/** A group, resolved for display: names rather than ids. */
export interface ReceivedGroup extends PaymentGroup {
  customerName: string | null;
  jobName: string | null;
  suggestedName: string;
  payments: ReceivedPayment[];
}

/** A project this contact already has, offered as somewhere to file money. */
export interface ProjectOption {
  id: string;
  name: string;
  status: string;
  customerId: string;
}

export interface ReceivedPaymentsData {
  groups: ReceivedGroup[];
  summary: GroupSummary;
  /** Contacts who have paid us and have no project at all. The headline gap. */
  undocumented: { customerId: string; customerName: string; totalCents: number }[];
  /** Every project, by contact, so a group can be filed against one. */
  projectsByCustomer: Record<string, ProjectOption[]>;
  /** Contacts with no property on file — a project cannot be made for them
   * without an address, so the UI has to ask rather than silently skip. */
  needAddress: string[];
}

interface PaymentQueryRow {
  id: string;
  customer_id: string | null;
  job_id: string | null;
  amount_cents: number;
  method: string;
  received_at: string;
  note: string | null;
  stripe_invoice_id: string | null;
  customers: { name: string } | null;
  jobs: { name: string } | null;
}

/**
 * Money received, gathered into the projects it belongs to.
 *
 * The grouping is worked out here rather than stored, so attaching a payment
 * to a project on one screen is reflected everywhere on the next read. See
 * `payment-grouping.ts` for the rules.
 */
export async function getReceivedPayments(): Promise<ReceivedPaymentsData> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();

  const { data: paymentRows } = await supabase
    .from("payments")
    .select(
      "id, customer_id, job_id, amount_cents, method, received_at, note, stripe_invoice_id, customers(name), jobs(name)"
    )
    .eq("organization_id", organizationId)
    .order("received_at", { ascending: false });

  const rows = (paymentRows ?? []) as unknown as PaymentQueryRow[];

  const payments: ReceivedPayment[] = rows.map((r) => ({
    id: r.id,
    customerId: r.customer_id,
    customerName: r.customers?.name ?? null,
    jobId: r.job_id,
    jobName: r.jobs?.name ?? null,
    amountCents: r.amount_cents,
    method: r.method,
    receivedAt: r.received_at,
    note: r.note,
    stripeInvoiceId: r.stripe_invoice_id,
  }));

  const forGrouping: PaymentRow[] = payments.map((p) => ({
    id: p.id,
    customerId: p.customerId,
    jobId: p.jobId,
    amountCents: p.amountCents,
    receivedAt: p.receivedAt,
    stripeInvoiceId: p.stripeInvoiceId,
  }));

  const byId = new Map(payments.map((p) => [p.id, p]));
  const groups: ReceivedGroup[] = groupPayments(forGrouping).map((g) => {
    const members = g.paymentIds.map((id) => byId.get(id)!).filter(Boolean);
    return {
      ...g,
      customerName: members.find((m) => m.customerName)?.customerName ?? null,
      jobName: members.find((m) => m.jobName)?.jobName ?? null,
      suggestedName: suggestedProjectName(g),
      payments: members,
    };
  });

  // Newest first: what somebody is looking for is nearly always recent.
  groups.sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));

  const undocumentedIds = contactsWithNoProject(groups);
  const undocumented = undocumentedIds
    .map((customerId) => {
      const theirs = groups.filter((g) => g.customerId === customerId);
      return {
        customerId,
        customerName: theirs.find((g) => g.customerName)?.customerName ?? "Unnamed contact",
        totalCents: theirs.reduce((sum, g) => sum + g.totalCents, 0),
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);

  const customerIds = [...new Set(payments.map((p) => p.customerId).filter(Boolean))] as string[];
  const [projectsByCustomer, needAddress] = await Promise.all([
    projectsFor(customerIds),
    customersWithoutProperty(customerIds),
  ]);

  return { groups, summary: summarise(groups), undocumented, projectsByCustomer, needAddress };
}

/** Every project belonging to these contacts, so money can be filed on one. */
async function projectsFor(customerIds: string[]): Promise<Record<string, ProjectOption[]>> {
  if (customerIds.length === 0) return {};
  const supabase = await createClient();

  const { data } = await supabase
    .from("jobs")
    .select("id, name, status, property_id, properties!inner(customer_id)")
    .in("properties.customer_id", customerIds)
    .order("created_at", { ascending: false });

  const out: Record<string, ProjectOption[]> = {};
  for (const row of (data ?? []) as unknown as {
    id: string;
    name: string;
    status: string;
    properties: { customer_id: string } | null;
  }[]) {
    const customerId = row.properties?.customer_id;
    if (!customerId) continue;
    (out[customerId] ??= []).push({
      id: row.id,
      name: row.name,
      status: row.status,
      customerId,
    });
  }
  return out;
}

/**
 * Contacts with no property on file.
 *
 * A project hangs off a property, and a property needs a real address — so
 * for these contacts "make a project" cannot be a one-tap action. Naming them
 * lets the screen ask for the address instead of failing at the last step.
 */
async function customersWithoutProperty(customerIds: string[]): Promise<string[]> {
  if (customerIds.length === 0) return [];
  const supabase = await createClient();

  const { data } = await supabase
    .from("properties")
    .select("customer_id")
    .in("customer_id", customerIds);

  const have = new Set(((data ?? []) as { customer_id: string }[]).map((r) => r.customer_id));
  return customerIds.filter((id) => !have.has(id));
}

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { suggestForPayer, type RankedContact, type SearchableContact } from "@/lib/payer-match";
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
  /** Who the payment said it was from, kept whether or not it matched. This
   * is what makes money with no contact fixable without the original file. */
  payerName: string | null;
  payerEmail: string | null;
  payerPhone: string | null;
}

/** A group, resolved for display: names rather than ids. */
export interface ReceivedGroup extends PaymentGroup {
  customerName: string | null;
  jobName: string | null;
  suggestedName: string;
  payments: ReceivedPayment[];
  /** What the payments in this group said about the payer. Only worth
   * showing when there is no contact — that is the case somebody has to
   * resolve by hand. */
  payerName: string | null;
  payerEmail: string | null;
  payerPhone: string | null;
  /** Contacts worth offering for a group with no contact, best first. */
  suggestions: RankedContact[];
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
  source_invoice_ref: string | null;
  payer_name: string | null;
  payer_email: string | null;
  payer_phone: string | null;
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
      "id, customer_id, job_id, amount_cents, method, received_at, note, stripe_invoice_id, source_invoice_ref, payer_name, payer_email, payer_phone, customers(name), jobs(name)"
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
    // Either invoice reference will do as a grouping key: what matters is
    // that two payments settling one invoice carry the same string.
    stripeInvoiceId: r.stripe_invoice_id ?? r.source_invoice_ref,
    payerName: r.payer_name,
    payerEmail: r.payer_email,
    payerPhone: r.payer_phone,
  }));

  const forGrouping: PaymentRow[] = payments.map((p) => ({
    id: p.id,
    customerId: p.customerId,
    jobId: p.jobId,
    amountCents: p.amountCents,
    receivedAt: p.receivedAt,
    stripeInvoiceId: p.stripeInvoiceId,
    payerEmail: p.payerEmail,
  }));

  const byId = new Map(payments.map((p) => [p.id, p]));
  const bare = groupPayments(forGrouping).map((g) => ({
    ...g,
    members: g.paymentIds.map((id) => byId.get(id)!).filter(Boolean),
  }));

  // Only the groups with no contact need a suggestion, and only their payer
  // details are worth looking anybody up by. Scoring the whole book against
  // every group would read three thousand contacts to answer a question about
  // a handful of payments.
  const unmatchedPayers = bare
    .filter((g) => !g.customerId)
    .map((g) => ({
      name: g.members.find((m) => m.payerName)?.payerName ?? null,
      email: g.members.find((m) => m.payerEmail)?.payerEmail ?? null,
      phone: g.members.find((m) => m.payerPhone)?.payerPhone ?? null,
    }));
  const candidates = await contactsMatchingPayers(unmatchedPayers);

  const groups: ReceivedGroup[] = bare.map((g) => {
    const { members, ...group } = g;
    const payerName = members.find((m) => m.payerName)?.payerName ?? null;
    const payerEmail = members.find((m) => m.payerEmail)?.payerEmail ?? null;
    const payerPhone = members.find((m) => m.payerPhone)?.payerPhone ?? null;

    return {
      ...group,
      customerName: members.find((m) => m.customerName)?.customerName ?? null,
      jobName: members.find((m) => m.jobName)?.jobName ?? null,
      suggestedName: suggestedProjectName(g),
      payments: members,
      payerName,
      payerEmail,
      payerPhone,
      suggestions: group.customerId
        ? []
        : suggestForPayer(candidates, { name: payerName, email: payerEmail, phone: payerPhone }),
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

/**
 * Contacts who might be the payer behind money with no contact on it.
 *
 * Looked up by the exact email and phone the payments arrived with, rather
 * than by reading the book and scoring all of it. The book is thousands of
 * rows and the question is about a handful of payments; the lookup is the
 * small half of that. A name gets no query — too many contacts share one for
 * a fetch to be worth it, and typing the name into the search box is the
 * better answer when the email is missing.
 */
async function contactsMatchingPayers(
  payers: { name: string | null; email: string | null; phone: string | null }[]
): Promise<SearchableContact[]> {
  const emails = [
    ...new Set(payers.map((p) => p.email?.trim().toLowerCase()).filter(Boolean)),
  ] as string[];
  const phones = [...new Set(payers.map((p) => p.phone?.trim()).filter(Boolean))] as string[];
  if (emails.length === 0 && phones.length === 0) return [];

  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const found = new Map<string, SearchableContact>();

  const lookup = async (column: "email" | "phone", values: string[]) => {
    for (let i = 0; i < values.length; i += 200) {
      const { data, error } = await supabase
        .from("customers")
        .select("id, name, email, phone")
        .eq("organization_id", organizationId)
        .in(column, values.slice(i, i + 200));

      // Not fatal. No suggestions is a screen that still works, with the
      // search box doing the job instead.
      if (error) {
        console.error(`Looking contacts up by ${column} failed:`, error);
        return;
      }
      for (const row of (data ?? []) as SearchableContact[]) found.set(row.id, row);
    }
  };

  await Promise.all([lookup("email", emails), lookup("phone", phones)]);
  return [...found.values()];
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

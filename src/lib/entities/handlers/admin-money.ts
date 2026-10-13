import type { ActionResult, EntityAction, EntityContext, EntityHandler, EntityRow } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import { freshInvoiceLink, openInvoiceFor, voidOpenInvoice } from "@/lib/invoicing";
import { getJobCustomerContact } from "@/lib/job-customer";
import { contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";
import { markPaymentCollected } from "@/lib/actions/collect-payment-actions";
import { deleteInvoice, updateInvoice } from "@/lib/actions/invoice-actions";
import { detachPayments } from "@/lib/actions/received-payment-actions";
import { deleteTeamPayment, markTeamPaymentPaid } from "@/lib/actions/payment-actions";
import { approveCommissionBatch } from "@/lib/actions/back-office-actions";
import { day, dollarsToCents, invoiceActionIds, isIsoDate, splitRef, usd, usdExact, words } from "@/lib/entities/handlers/admin-format";
import { UNKNOWN, fields, many, num, one, personName, result, str, type Row } from "@/lib/entities/handlers/admin-common";

/**
 * The Admin page's money: invoices (Stripe ones raised from a job, and
 * uploaded ones from the old books), payments received, bank lines, team
 * pay waiting to go out, and the weekly commission statements.
 */

const STRIPE_INVOICE = "id, job_id, amount, status, sent_at, created_at, paid_at, pay_by, collected_note, hosted_invoice_url, stripe_invoice_id, jobs(name, properties(customers(id, name)))";
const UPLOADED_INVOICE = "id, customer_id, amount, issued_on, due_on, paid_on, title, invoice_number, notes, file_path, source, customers(name)";

const INVOICE_ACTION: Record<string, EntityAction> = {
  resend_sms: { id: "resend_sms", label: "Text the link again", tone: "primary", confirm: "Text the client the payment link again?" },
  resend_email: { id: "resend_email", label: "Email the link again", confirm: "Email the client the payment link again?" },
  paid_cash: { id: "paid_cash", label: "Paid by cash", input: { type: "number", label: "Amount ($)", required: true } },
  paid_check: { id: "paid_check", label: "Paid by check", input: { type: "number", label: "Amount ($)", required: true } },
  void: { id: "void", label: "Void", tone: "danger", confirm: "Void this invoice? The client's link stops working." },
  unpaid: { id: "unpaid", label: "Not paid after all", confirm: "Mark this invoice unpaid again?" },
  delete: { id: "delete", label: "Delete", tone: "danger", confirm: "Delete this invoice and its file? This can't be undone." },
};

async function resend(ctx: EntityContext, inv: Row, channel: "sms" | "email"): Promise<ActionResult> {
  if (inv.status !== "open") return { ok: false, error: "Only an unpaid invoice can be sent again." };
  const link = await freshInvoiceLink({ id: str(inv.id), hostedUrl: str(inv.hosted_invoice_url) || null, stripeInvoiceId: str(inv.stripe_invoice_id) || null });
  if (!link) return { ok: false, error: "Stripe has no payment link for this invoice." };
  const contact = await getJobCustomerContact(str(inv.job_id));
  if (!contact?.customerId || contact.organizationId !== ctx.organizationId) return { ok: false, error: "The job has no client on it." };
  const [contacts, org] = await Promise.all([
    contactsFor([contact.customerId]),
    one(ctx.sb.from("organizations").select("name, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", ctx.organizationId)),
  ]);
  const who = contacts.get(contact.customerId);
  if (!who) return { ok: false, error: "Couldn't find the client." };
  const business = str(org?.name) || "JS Landscaping MD";
  const job = str((inv.jobs as Row | null)?.name) || "your project";
  const outcome = await sendClientMessage(
    {
      organizationId: ctx.organizationId,
      customerId: contact.customerId,
      channel,
      basis: "service",
      kind: "invoice_resend",
      referenceId: str(inv.id),
      // Typed by the owner each time, so each press is its own send.
      dedupeKey: `invoice_resend:${str(inv.id)}:${channel}:${Date.now()}`,
      subject: `Your invoice from ${business}`,
      body: `Your invoice for ${job} (${usdExact(num(inv.amount))}) is here: ${link}`,
      automatic: false,
    },
    who,
    quietWindowFor((org ?? {}) as { reminder_quiet_start?: number | null; reminder_quiet_end?: number | null; reminder_time_zone?: string | null })
  );
  return outcome.sent ? { ok: true, message: channel === "sms" ? "Texted." : "Emailed." } : { ok: false, error: outcome.detail };
}

const invoiceHandler: EntityHandler = {
  kind: "admin.invoice",
  async load(ctx, id) {
    const stripe = await one(ctx.sb.from("invoices").select(STRIPE_INVOICE).eq("id", id).eq("organization_id", ctx.organizationId));
    if (stripe) {
      const job = stripe.jobs as Row | null;
      const customer = ((job?.properties as Row | null)?.customers as Row | null) ?? null;
      const paid = stripe.stripe_invoice_id
        ? await many(ctx.sb.from("payments").select("id, amount_cents, method, received_at").eq("organization_id", ctx.organizationId).eq("stripe_invoice_id", str(stripe.stripe_invoice_id)))
        : [];
      const ids = invoiceActionIds({ source: "stripe", status: str(stripe.status), hasLink: Boolean(stripe.hosted_invoice_url || stripe.stripe_invoice_id) });
      const amount = String(num(stripe.amount));
      return {
        title: `Invoice · ${usdExact(num(stripe.amount))}`,
        subtitle: [str(customer?.name), str(job?.name)].filter(Boolean).join(" · ") || undefined,
        status: words(str(stripe.status)),
        fields: fields([
          ["Sent", day(str(stripe.sent_at) || str(stripe.created_at))],
          ["Paid", stripe.paid_at ? `${day(str(stripe.paid_at))}${stripe.pay_by ? ` by ${str(stripe.pay_by)}` : ""}` : ""],
          ["Note", stripe.collected_note],
          ["Payment link", stripe.hosted_invoice_url],
        ]),
        sections: [
          { title: "Client and job", rows: [...(customer ? [row(str(customer.name) || "Client", "admin.customer", customer.id)] : []), row(str(job?.name) || "Job", "admin.job", stripe.job_id)] },
          { title: "Payments against it", rows: paid.map((p) => row(`${day(str(p.received_at))} · ${usdExact(num(p.amount_cents) / 100)} · ${words(str(p.method))}`, "admin.payment", p.id)), empty: "Nothing paid yet." },
        ],
        actions: ids.map((a) => (a === "paid_cash" || a === "paid_check" ? { ...INVOICE_ACTION[a], input: { ...INVOICE_ACTION[a].input!, initial: amount } } : INVOICE_ACTION[a])),
        note: ids.length ? "Paid by cash or check records the payment on the job, marks the invoice paid and tells Stripe." : undefined,
      };
    }

    const up = await one(ctx.sb.from("client_invoices").select(UPLOADED_INVOICE).eq("id", id).eq("organization_id", ctx.organizationId));
    if (!up) return null;
    const status = up.paid_on ? "paid" : "open";
    const ids = invoiceActionIds({ source: "upload", status, hasLink: false });
    return {
      title: `${str(up.title) || "Invoice"}${up.invoice_number ? ` #${str(up.invoice_number)}` : ""}`,
      subtitle: str((up.customers as Row | null)?.name) || undefined,
      status: up.paid_on ? `Paid ${day(str(up.paid_on))}` : "Open",
      fields: fields([
        ["Amount", usdExact(num(up.amount))],
        ["Issued", day(str(up.issued_on))],
        ["Due", up.due_on ? day(str(up.due_on)) : ""],
        ["From", words(str(up.source))],
        ["Notes", up.notes],
      ]),
      sections: up.customer_id ? [{ title: "Client", rows: [row(str((up.customers as Row | null)?.name) || "Client", "admin.customer", up.customer_id)] }] : undefined,
      actions: ids.map((a) => (a === "paid_cash" || a === "paid_check" ? { id: a, label: INVOICE_ACTION[a].label, input: { type: "date" as const, label: "Paid on", initial: new Date().toISOString().slice(0, 10), required: true } } : INVOICE_ACTION[a])),
      note: "An invoice from the old books, kept as a file. It has no payment link to send.",
    };
  },
  async act(ctx, id, action, value) {
    const stripe = await one(ctx.sb.from("invoices").select(STRIPE_INVOICE).eq("id", id).eq("organization_id", ctx.organizationId));
    if (stripe) {
      const allowed = invoiceActionIds({ source: "stripe", status: str(stripe.status), hasLink: Boolean(stripe.hosted_invoice_url || stripe.stripe_invoice_id) });
      if (!allowed.includes(action)) return { ok: false, error: "That can't be done to this invoice now." };
      switch (action) {
        case "resend_sms":
          return resend(ctx, stripe, "sms");
        case "resend_email":
          return resend(ctx, stripe, "email");
        case "paid_cash":
        case "paid_check": {
          const cents = dollarsToCents(value);
          if (!cents) return { ok: false, error: "How much was it?" };
          return result(await markPaymentCollected({ invoiceId: id, method: action === "paid_cash" ? "cash" : "check", amountCents: cents }));
        }
        case "void": {
          const open = await openInvoiceFor(str(stripe.job_id));
          if (open?.id !== id) return { ok: false, error: "This isn't the job's live invoice, so there is nothing to void." };
          await voidOpenInvoice(str(stripe.job_id));
          return { ok: true, message: "Voided." };
        }
      }
      return UNKNOWN;
    }

    const up = await one(ctx.sb.from("client_invoices").select("id, paid_on, notes, file_path").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!up) return { ok: false, error: "Couldn't find that invoice." };
    switch (action) {
      case "paid_cash":
      case "paid_check": {
        if (!isIsoDate(value)) return { ok: false, error: "Pick the day it was paid." };
        const how = `Paid by ${action === "paid_cash" ? "cash" : "check"} on ${value}.`;
        return result(await updateInvoice(id, { paidOn: value, notes: [str(up.notes), how].filter(Boolean).join("\n") }), "Marked paid.");
      }
      case "unpaid":
        return result(await updateInvoice(id, { paidOn: "" }), "Marked unpaid.");
      case "delete":
        return result(await deleteInvoice(id, str(up.file_path)), "Deleted.");
    }
    return UNKNOWN;
  },
};

const paymentHandler: EntityHandler = {
  kind: "admin.payment",
  async load(ctx, id) {
    const p = await one(
      ctx.sb
        .from("payments")
        .select("id, amount_cents, surcharge_cents, method, received_at, note, payer_name, payer_email, source, source_invoice_ref, customer_id, job_id, stripe_invoice_id, customers(name), jobs(name)")
        .eq("id", id)
        .eq("organization_id", ctx.organizationId)
    );
    if (!p) return null;
    const inv = p.stripe_invoice_id ? await one(ctx.sb.from("invoices").select("id, amount, status").eq("organization_id", ctx.organizationId).eq("stripe_invoice_id", str(p.stripe_invoice_id))) : null;
    const related: EntityRow[] = [];
    if (p.customer_id) related.push(row(`Client: ${str((p.customers as Row | null)?.name) || "Client"}`, "admin.customer", p.customer_id));
    if (p.job_id) related.push(row(`Job: ${str((p.jobs as Row | null)?.name) || "Job"}`, "admin.job", p.job_id));
    if (inv) related.push(row(`Invoice: ${usd(num(inv.amount))} · ${words(str(inv.status))}`, "admin.invoice", inv.id));
    return {
      title: `Payment · ${usdExact(num(p.amount_cents) / 100)}`,
      subtitle: `${words(str(p.method))} · ${day(str(p.received_at))}`,
      fields: fields([
        ["Card surcharge", p.surcharge_cents ? usdExact(num(p.surcharge_cents) / 100) : ""],
        ["Paid by", [str(p.payer_name), str(p.payer_email)].filter(Boolean).join(" · ")],
        ["Came from", words(str(p.source))],
        ["Their reference", p.source_invoice_ref],
        ["Note", p.note],
      ]),
      sections: [{ title: "Filed against", rows: related, empty: "Not filed against a client or job yet." }],
      actions: p.job_id ? [{ id: "detach", label: "Take it off the job", tone: "danger", confirm: "Unfile this payment from its job?" }] : [],
    };
  },
  async act(ctx, id, action) {
    if (action !== "detach") return UNKNOWN;
    const p = await one(ctx.sb.from("payments").select("id").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!p) return { ok: false, error: "Couldn't find that payment." };
    return result(await detachPayments([id]), "Taken off the job.");
  },
};

const bankLineHandler: EntityHandler = {
  kind: "admin.bank_tx",
  async load(ctx, id) {
    const t = await one(ctx.sb.from("bank_transactions").select("id, name, merchant, amount, posted_on, category, pending").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!t) return null;
    const amount = num(t.amount);
    return {
      title: str(t.merchant) || str(t.name) || "Bank line",
      subtitle: day(str(t.posted_on)),
      status: t.pending ? "Pending" : undefined,
      fields: fields([
        // Plaid's sign: money out is positive.
        [amount > 0 ? "Money out" : "Money in", usdExact(Math.abs(amount))],
        ["As the bank wrote it", t.name],
        ["Category", words(str(t.category))],
      ]),
      actions: [],
      note: "A line from the bank feed. It is matched to payments and costs by the bookkeeping run, not by hand here.",
    };
  },
};

const teamPaymentHandler: EntityHandler = {
  kind: "admin.team_payment",
  async load(ctx, id) {
    const t = await one(ctx.sb.from("team_payments").select("id, profile_id, amount, hours, status, period_start, period_end, paid_at, method, note, profiles(full_name, first_name, last_name, email)").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!t) return null;
    const pending = t.status === "pending";
    return {
      title: `Pay · ${personName(t.profiles as Row | null)}`,
      subtitle: t.period_start ? `${day(str(t.period_start))} to ${day(str(t.period_end))}` : undefined,
      status: words(str(t.status)),
      fields: fields([
        ["Amount", usdExact(num(t.amount))],
        ["Hours", t.hours],
        ["Paid", t.paid_at ? `${day(str(t.paid_at))}${t.method ? ` by ${str(t.method)}` : ""}` : ""],
        ["Note", t.note],
      ]),
      sections: t.profile_id ? [{ title: "Person", rows: [row(personName(t.profiles as Row | null), "admin.profile", t.profile_id)] }] : undefined,
      actions: pending
        ? [
            { id: "paid_transfer", label: "Paid by transfer", tone: "primary" },
            { id: "paid_check", label: "Paid by check" },
            { id: "paid_cash", label: "Paid by cash" },
            { id: "delete", label: "Delete", tone: "danger", confirm: "Delete this pay entry? Only for one recorded by mistake." },
          ]
        : [],
    };
  },
  async act(ctx, id, action) {
    const t = await one(ctx.sb.from("team_payments").select("id").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!t) return { ok: false, error: "Couldn't find that pay entry." };
    if (action === "paid_transfer" || action === "paid_check" || action === "paid_cash") {
      return result(await markTeamPaymentPaid(id, action.slice(5) as "transfer" | "check" | "cash"), "Marked paid.");
    }
    if (action === "delete") return result(await deleteTeamPayment(id), "Deleted.");
    return UNKNOWN;
  },
};

/* ------------------------------------------------------------------ */
/* Commissions                                                          */
/* ------------------------------------------------------------------ */

type Line = { jobId: string; customer?: string | null; amount: number; offset?: number };

async function batch(ctx: EntityContext, id: string) {
  const b = await one(ctx.admin.from("commission_payout_batches").select("id, week_start, week_end, total, status, approved_at").eq("id", id).eq("organization_id", ctx.organizationId));
  if (!b) return null;
  const statements = await many(ctx.admin.from("commission_statements").select("profile_id, total, lines").eq("batch_id", id));
  const ids = statements.map((s) => str(s.profile_id));
  const people = ids.length ? await many(ctx.admin.from("profiles").select("id, full_name, first_name, last_name, email").in("id", ids).eq("organization_id", ctx.organizationId)) : [];
  const nameOf = (pid: unknown) => personName(people.find((p) => p.id === pid));
  return { b, statements, nameOf };
}

const batchStatus = (s: unknown) => (s === "awaiting_approval" ? "Waiting for approval" : words(str(s)));

const approveAction = (total: number): EntityAction => ({ id: "approve", label: `Approve ${usdExact(total)}`, tone: "primary", confirm: `Approve ${usdExact(total)} and record it as paid?` });

const commissionBatchHandler: EntityHandler = {
  kind: "admin.commission_batch",
  async load(ctx, id) {
    const found = await batch(ctx, id);
    if (!found) return null;
    const { b, statements, nameOf } = found;
    return {
      title: `Commissions ${day(str(b.week_start))} to ${day(str(b.week_end))}`,
      subtitle: `${statements.length} statement${statements.length === 1 ? "" : "s"}`,
      status: batchStatus(b.status),
      fields: fields([
        ["Total", usdExact(num(b.total))],
        ["Approved", b.approved_at ? day(str(b.approved_at)) : ""],
      ]),
      sections: [
        {
          title: "Statements",
          rows: statements.sort((x, y) => num(y.total) - num(x.total)).map((s) => row(`${nameOf(s.profile_id)} · ${usdExact(num(s.total))}`, "admin.commission_statement", `${id}:${str(s.profile_id)}`)),
          empty: "No statements in this week.",
        },
      ],
      actions: b.status === "awaiting_approval" ? [approveAction(num(b.total))] : [],
      note: b.status === "awaiting_approval" ? "Approving records every payout in it, one per job per person." : undefined,
    };
  },
  async act(ctx, id, action) {
    if (action !== "approve") return UNKNOWN;
    if (!(await batch(ctx, id))) return { ok: false, error: "Couldn't find that week." };
    return result(await approveCommissionBatch(id));
  },
};

const commissionStatementHandler: EntityHandler = {
  kind: "admin.commission_statement",
  async load(ctx, id) {
    const [batchId, profileId] = splitRef(id);
    const found = await batch(ctx, batchId);
    if (!found) return null;
    const { b, statements, nameOf } = found;
    const s = statements.find((x) => x.profile_id === profileId);
    if (!s) return null;
    const lines = ((s.lines ?? []) as Line[]).map((l) =>
      row(`${l.customer ?? "Job"} · ${usdExact(num(l.amount))}${num(l.offset) > 0 ? ` (${usdExact(num(l.offset))} already paid by hand)` : ""}`, "admin.job", l.jobId)
    );
    return {
      title: `${nameOf(profileId)} · ${usdExact(num(s.total))}`,
      subtitle: `Week of ${day(str(b.week_start))}`,
      status: batchStatus(b.status),
      fields: [],
      sections: [
        { title: "Jobs", rows: lines, empty: "No lines." },
        { title: "Person and week", rows: [row(nameOf(profileId), "admin.profile", profileId), row(`The whole week · ${usdExact(num(b.total))}`, "admin.commission_batch", batchId)] },
      ],
      actions: b.status === "awaiting_approval" ? [{ ...approveAction(num(b.total)), label: `Approve the week (${usdExact(num(b.total))})` }] : [],
      note: b.status === "awaiting_approval" ? "Statements are approved a week at a time, everybody's together." : undefined,
    };
  },
  async act(ctx, id, action) {
    if (action !== "approve") return UNKNOWN;
    const [batchId] = splitRef(id);
    if (!(await batch(ctx, batchId))) return { ok: false, error: "Couldn't find that week." };
    return result(await approveCommissionBatch(batchId));
  },
};

export const ADMIN_MONEY_HANDLERS: EntityHandler[] = [
  invoiceHandler,
  paymentHandler,
  bankLineHandler,
  teamPaymentHandler,
  commissionBatchHandler,
  commissionStatementHandler,
];

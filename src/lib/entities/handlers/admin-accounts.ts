import type { EntityAction, EntityContext, EntityHandler, EntityRow, EntityView } from "@/lib/entities/types";
import { row } from "@/lib/entities/types";
import { loadApprovalQueue } from "@/lib/data/approval-queue";
import { QUEUE_TYPE_LABEL, isQueueType } from "@/lib/approvals/queue";
import { DECLINE_REASONS, DECLINE_REASON_LABEL } from "@/lib/approvals/declines";
import { approveQueueItem, declineQueueItem } from "@/lib/actions/approval-queue-actions";
import { assignAccountManager, updateCustomerContact } from "@/lib/actions/customer-actions";
import { generateClientCoi, openClientCoi, sendClientCoi } from "@/lib/actions/back-office-actions";
import { acceptPrice, setPrice } from "@/lib/actions/price-approval-actions";
import { raiseInvoiceForJob } from "@/lib/actions/job-invoice-actions";
import { cancelEstimate } from "@/lib/actions/job-actions";
import { closeOneSession, closePastSessions, recomputeJobCost } from "@/lib/actions/ops-autopilot-actions";
import { markPosted } from "@/lib/actions/social-actions";
import { setMaterialOnOrder, updateMaterialQuantityOnHand, updateMaterialReorderThreshold } from "@/lib/actions/material-actions";
import { retireAsset } from "@/lib/actions/fleet-actions";
import { resolveIssue } from "@/lib/actions/issue-actions";
import { roleKeysOf } from "@/lib/roles";
import {
  ALERT_TITLE,
  backOfficeRef,
  day,
  isAlertKey,
  jobIdFromHref,
  splitRef,
  splitResolution,
  usd,
  words,
  type AlertKey,
} from "@/lib/entities/handlers/admin-format";
import { UNKNOWN, attempt, fields, many, num, one, personName, result, str, type Row } from "@/lib/entities/handlers/admin-common";

/**
 * The Admin page's oversight lists: the alerts across the departments and
 * what is in each, the approval queue's items, every customer account, and
 * the jobs, work days, posts, materials, vehicles and issues the alerts
 * point at. Kinds are admin.* even where the thing belongs to another
 * department, so each department's drawer stays its own.
 */

const today = () => new Date().toISOString().slice(0, 10);

const DECLINE_INPUT = {
  type: "select" as const,
  label: "Why not?",
  options: DECLINE_REASONS.map((r) => ({ value: r, label: DECLINE_REASON_LABEL[r] })),
  required: true,
};

/* ------------------------------------------------------------------ */
/* Alerts                                                               */
/* ------------------------------------------------------------------ */

/** What is in one alert, newest or most urgent first. Shared with the loader's counts by the same filters. */
export async function alertRows(ctx: EntityContext, key: AlertKey): Promise<EntityRow[]> {
  const org = ctx.organizationId;
  const nowIso = new Date().toISOString();
  switch (key) {
    case "approvals": {
      const list = await many(ctx.sb.from("job_proposals").select("job_id, total_cost, jobs(name)").eq("organization_id", org).eq("status", "needs_approval").limit(50));
      return list.map((p) => row(`${str((p.jobs as Row | null)?.name) || "Job"} · ${usd(num(p.total_cost))}`, "admin.queue_item", `price:${str(p.job_id)}`));
    }
    case "stale_evals": {
      const list = await many(ctx.sb.from("jobs").select("id, name, evaluation_date").eq("organization_id", org).eq("evaluation_status", "scheduled").lt("evaluation_date", nowIso).order("evaluation_date", { ascending: true }).limit(50));
      return list.map((j) => row(`${str(j.name) || "Job"} · was ${day(str(j.evaluation_date))}`, "admin.job", j.id));
    }
    case "stale_days": {
      const list = await many(ctx.sb.from("job_work_sessions").select("id, starts_on, jobs(name)").eq("organization_id", org).eq("status", "scheduled").lt("starts_on", today()).order("starts_on", { ascending: true }).limit(50));
      return list.map((s) => row(`${day(str(s.starts_on))} · ${str((s.jobs as Row | null)?.name) || "Job"}`, "admin.work_day", s.id));
    }
    case "late_posts": {
      const list = await many(ctx.sb.from("social_posts").select("id, hook, caption, kind, scheduled_for").eq("organization_id", org).eq("status", "scheduled").lt("scheduled_for", nowIso).order("scheduled_for", { ascending: true }).limit(50));
      return list.map((p) => row(`${day(str(p.scheduled_for))} · ${(str(p.hook) || str(p.caption) || words(str(p.kind))).slice(0, 60)}`, "admin.social_post", p.id));
    }
    case "low_materials": {
      const list = await many(ctx.sb.from("materials").select("id, name, unit, quantity_on_hand, reorder_threshold").eq("organization_id", org).not("quantity_on_hand", "is", null).not("reorder_threshold", "is", null));
      return list
        .filter((m) => num(m.quantity_on_hand) < num(m.reorder_threshold))
        .map((m) => row(`${str(m.name)} · ${num(m.quantity_on_hand)} of ${num(m.reorder_threshold)} ${str(m.unit)}`.trim(), "admin.material", m.id));
    }
    case "failing_fleet": {
      const list = await many(ctx.sb.from("fleet_assets").select("id, name, kind").eq("organization_id", org).eq("condition", "failing").is("retired_on", null));
      return list.map((f) => row(`${str(f.name)} · ${words(str(f.kind))}`, "admin.fleet_asset", f.id));
    }
    case "open_issues": {
      const list = await many(ctx.sb.from("job_issues").select("id, title, severity, created_at").eq("organization_id", org).eq("status", "open").order("created_at", { ascending: false }).limit(50));
      return list.map((i) => row(`${str(i.title) || "Issue"}${i.severity ? ` · ${str(i.severity)}` : ""} · ${day(str(i.created_at))}`, "admin.job_issue", i.id));
    }
  }
}

const alertHandler: EntityHandler = {
  kind: "admin.alert",
  async load(ctx, id) {
    if (!isAlertKey(id)) return null;
    const rows = await alertRows(ctx, id);
    const actions: EntityAction[] =
      id === "stale_days" && rows.length
        ? [
            { id: "close_done", label: "Mark them all done", tone: "primary", confirm: `Close all ${rows.length} work days as done?` },
            { id: "close_cancelled", label: "Mark them all cancelled", tone: "danger", confirm: `Close all ${rows.length} work days as cancelled?` },
          ]
        : [];
    return {
      title: ALERT_TITLE[id],
      subtitle: `${rows.length} right now`,
      fields: [],
      sections: [{ title: "In this alert", rows, empty: "Nothing left in this one." }],
      actions,
      note: actions.length ? undefined : "Open each one to deal with it.",
    };
  },
  async act(ctx, id, action) {
    if (id !== "stale_days" || (action !== "close_done" && action !== "close_cancelled")) return UNKNOWN;
    const ids = (await alertRows(ctx, "stale_days")).map((r) => r.ref?.id).filter((x): x is string => Boolean(x));
    if (!ids.length) return { ok: false, error: "There are none left." };
    return result(await closePastSessions(ids, action === "close_done" ? "done" : "cancelled"));
  },
};

/* ------------------------------------------------------------------ */
/* Approval queue items                                                 */
/* ------------------------------------------------------------------ */

const queueItemHandler: EntityHandler = {
  kind: "admin.queue_item",
  async load(ctx, id) {
    const [type, itemId] = splitRef(id);
    if (!isQueueType(type)) return null;
    const items = await loadApprovalQueue(ctx.admin, ctx.organizationId);
    const item = items.find((i) => i.type === type && i.id === itemId);
    if (!item) return null;

    const related: EntityRow[] = [];
    const jobId = jobIdFromHref(item.href);
    if (type === "price") related.push(row("The job", "admin.job", item.id));
    else if (jobId) related.push(row("The job", "admin.job", jobId));
    if (type === "social") related.push(row("The post", "admin.social_post", item.id));
    if (type === "back_office") {
      const ref = item.kind === "commission_payout" ? { kind: "admin.commission_batch", id: item.id } : backOfficeRef(item.id);
      if (ref) related.push({ text: "Open it", ref });
    }

    const actions: EntityAction[] = [];
    if (item.canApprove) {
      actions.push({ id: "approve", label: item.approveLabel, tone: "primary", confirm: type === "back_office" ? `${item.approveLabel} and record it as paid?` : undefined });
    }
    if (item.canDecline) actions.push({ id: "decline", label: type === "price" ? "Not this price" : "Decline", input: DECLINE_INPUT });

    return {
      title: item.title,
      subtitle: QUEUE_TYPE_LABEL[item.type],
      status: item.dueAt ? `Stale ${day(item.dueAt)}` : undefined,
      fields: fields([
        ["What", item.detail],
        ["Waiting since", day(item.since)],
        ["The words", item.body],
      ]),
      sections: related.length ? [{ title: "What it is about", rows: related }] : undefined,
      actions,
      note: actions.length ? undefined : "Nothing to approve here; open it to deal with it.",
    };
  },
  async act(_ctx, id, action, value) {
    const [type, itemId] = splitRef(id);
    if (action === "approve") return result(await approveQueueItem(type, itemId));
    if (action === "decline") return result(await declineQueueItem(type, itemId, value ?? ""));
    return UNKNOWN;
  },
};

/* ------------------------------------------------------------------ */
/* Customer accounts                                                    */
/* ------------------------------------------------------------------ */

async function managers(ctx: EntityContext): Promise<{ value: string; label: string }[]> {
  const people = await many(ctx.sb.from("profiles").select("id, full_name, first_name, last_name, email").eq("organization_id", ctx.organizationId));
  const ids = people.map((p) => str(p.id));
  const roles = ids.length ? await many(ctx.sb.from("profile_roles").select("profile_id, role_name").in("profile_id", ids)) : [];
  return people
    .filter((p) => {
      const held = roles.filter((r) => r.profile_id === p.id).map((r) => str(r.role_name));
      const keys = roleKeysOf(held);
      return keys.includes("account-manager") || keys.includes("owner");
    })
    .map((p) => ({ value: str(p.id), label: personName(p) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

const consentWords = (c: Row | undefined) => (c ? `${words(str(c.state))}${c.source ? ` (${str(c.source)}, ${day(str(c.changed_at))})` : ""}` : "Not asked");

const customerHandler: EntityHandler = {
  kind: "admin.customer",
  async load(ctx, id): Promise<EntityView | null> {
    const sb = ctx.sb;
    const org = ctx.organizationId;
    const c = await one(sb.from("customers").select("id, name, email, phone, source, contact_type, created_at, account_manager_id, do_not_contact, notes, pipeline_stage").eq("id", id).eq("organization_id", org));
    if (!c) return null;
    const props = await many(sb.from("properties").select("id, address").eq("customer_id", id));
    const propIds = props.map((p) => str(p.id));
    const jobs = propIds.length ? await many(sb.from("jobs").select("id, name, status, created_at").in("property_id", propIds).order("created_at", { ascending: false }).limit(25)) : [];
    const jobIds = jobs.map((j) => str(j.id));
    const [stripeInv, uploaded, payments, messages, consent, cois, am, amOptions] = await Promise.all([
      jobIds.length ? many(sb.from("invoices").select("id, amount, status, created_at").in("job_id", jobIds).order("created_at", { ascending: false }).limit(25)) : Promise.resolve([] as Row[]),
      many(sb.from("client_invoices").select("id, amount, issued_on, paid_on, invoice_number").eq("customer_id", id).eq("organization_id", org).order("issued_on", { ascending: false }).limit(25)),
      many(sb.from("payments").select("id, amount_cents, method, received_at").eq("customer_id", id).eq("organization_id", org).order("received_at", { ascending: false }).limit(25)),
      many(sb.from("client_message_log").select("id, channel, kind, status, created_at").eq("customer_id", id).eq("organization_id", org).order("created_at", { ascending: false }).limit(25)),
      many(sb.from("client_consent").select("channel, state, source, changed_at").eq("customer_id", id)),
      many(ctx.admin.from("client_cois").select("id, holder_name, created_at, sent_at").eq("customer_id", id).eq("organization_id", org).order("created_at", { ascending: false }).limit(10)),
      c.account_manager_id ? one(sb.from("profiles").select("id, full_name, first_name, last_name, email").eq("id", str(c.account_manager_id))) : Promise.resolve(null),
      managers(ctx),
    ]);
    const sms = consent.find((x) => x.channel === "sms");
    const email = consent.find((x) => x.channel === "email");
    const invoices: EntityRow[] = [
      ...stripeInv.map((i) => row(`${day(str(i.created_at))} · ${usd(num(i.amount))} · ${words(str(i.status))}`, "admin.invoice", i.id)),
      ...uploaded.map((i) => row(`${day(str(i.issued_on))} · ${usd(num(i.amount))} · ${i.paid_on ? "Paid" : "Open"}${i.invoice_number ? ` · #${str(i.invoice_number)}` : ""}`, "admin.invoice", i.id)),
    ];

    return {
      title: str(c.name) || "Customer",
      subtitle: `${words(str(c.contact_type))} since ${day(str(c.created_at))}`,
      status: c.do_not_contact ? "Do not contact" : undefined,
      fields: fields([
        ["Email", c.email],
        ["Phone", c.phone],
        ["Account manager", am ? personName(am) : "Nobody yet"],
        ["Lead source", c.source || "None on file"],
        ["Pipeline stage", words(str(c.pipeline_stage))],
        ["Texts", consentWords(sms)],
        ["Emails", consentWords(email)],
        ["Notes", c.notes],
      ]),
      sections: [
        { title: "Contacts and properties", rows: [...[str(c.email), str(c.phone)].filter(Boolean).map((t) => ({ text: t })), ...props.map((p) => ({ text: str(p.address) || "Property" }))], empty: "No address or contact details on file." },
        { title: "Jobs", rows: jobs.map((j) => row(`${str(j.name) || "Job"} · ${words(str(j.status))}`, "admin.job", j.id)), empty: "No jobs." },
        { title: "Invoices", rows: invoices, empty: "No invoices." },
        { title: "Payments", rows: payments.map((p) => row(`${day(str(p.received_at))} · ${usd(num(p.amount_cents) / 100)} · ${words(str(p.method))}`, "admin.payment", p.id)), empty: "No payments." },
        { title: "Messages", rows: messages.map((m) => row(`${day(str(m.created_at))} · ${str(m.channel).toUpperCase()} · ${words(str(m.kind))} · ${str(m.status)}`, "admin.message", m.id)), empty: "Nothing sent yet." },
        { title: "Consent", rows: [{ text: `Texts: ${consentWords(sms)}` }, { text: `Emails: ${consentWords(email)}` }] },
        { title: "Certificates of insurance", rows: cois.map((x) => row(`${str(x.holder_name)} · ${x.sent_at ? `sent ${day(str(x.sent_at))}` : `made ${day(str(x.created_at))}, not sent`}`, "admin.coi", x.id)), empty: "None made." },
      ],
      actions: [
        {
          id: "assign_am",
          label: "Assign account manager",
          tone: "primary",
          input: { type: "select", label: "Account manager", options: [{ value: "", label: "Nobody" }, ...amOptions], initial: str(c.account_manager_id) },
        },
        { id: "set_email", label: "Change email", input: { type: "email", label: "Email", initial: str(c.email) } },
        { id: "set_phone", label: "Change phone", input: { type: "tel", label: "Phone", initial: str(c.phone) } },
        { id: "consent_sms", label: "Record text consent", input: { type: "textarea", label: "How they agreed (their words, the form, the call)", required: true } },
        { id: "consent_email", label: "Record email consent", input: { type: "textarea", label: "How they agreed", required: true } },
        { id: "stop_sms", label: "Stop texts", tone: "danger", confirm: "Record that this client said no to texts?" },
        { id: "stop_email", label: "Stop emails", tone: "danger", confirm: "Record that this client said no to emails?" },
        c.do_not_contact
          ? { id: "dnc_off", label: "Allow contact again", confirm: "Take this client off do-not-contact?" }
          : { id: "dnc_on", label: "Do not contact", tone: "danger", confirm: "Stop every message to this client?" },
        { id: "make_coi", label: "Make a certificate of insurance", input: { type: "text", label: "Certificate holder", initial: str(c.name), required: true } },
      ],
      note: "Messages to a client only ever go through the app's one sending door, so consent and do-not-contact always apply.",
    };
  },
  async act(ctx, id, action, value) {
    const sb = ctx.sb;
    const c = await one(sb.from("customers").select("id, email, phone").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!c) return { ok: false, error: "Couldn't find that customer." };
    switch (action) {
      case "assign_am": {
        const pick = (value ?? "").trim();
        if (pick && !(await managers(ctx)).some((m) => m.value === pick)) return { ok: false, error: "Pick an account manager from the list." };
        return attempt(() => assignAccountManager(id, pick || null), pick ? "Account manager assigned." : "Account manager taken off.");
      }
      case "set_email": {
        const email = (value ?? "").trim();
        if (email && !email.includes("@")) return { ok: false, error: "That email does not look right." };
        return attempt(() => updateCustomerContact(id, { email: email || null, phone: str(c.phone) || null }), "Email saved.");
      }
      case "set_phone":
        return attempt(() => updateCustomerContact(id, { email: str(c.email) || null, phone: (value ?? "").trim() || null }), "Phone saved.");
      case "consent_sms":
      case "consent_email":
      case "stop_sms":
      case "stop_email": {
        const channel = action.endsWith("sms") ? "sms" : "email";
        const granted = action.startsWith("consent");
        const evidence = (value ?? "").trim();
        if (granted && !evidence) return { ok: false, error: "Say how they agreed." };
        const { error } = await sb.from("client_consent").upsert(
          {
            organization_id: ctx.organizationId,
            customer_id: id,
            channel,
            state: granted ? "granted" : "revoked",
            source: "office",
            evidence: granted ? evidence.slice(0, 2000) : "Recorded by the owner",
            changed_at: new Date().toISOString(),
            changed_by: ctx.profileId,
          },
          { onConflict: "customer_id,channel" }
        );
        return error ? { ok: false, error: error.message } : { ok: true, message: granted ? "Consent recorded." : `No more ${channel === "sms" ? "texts" : "emails"}.` };
      }
      case "dnc_on":
      case "dnc_off": {
        const { error } = await sb.from("customers").update({ do_not_contact: action === "dnc_on" }).eq("id", id).eq("organization_id", ctx.organizationId);
        return error ? { ok: false, error: error.message } : { ok: true, message: action === "dnc_on" ? "Nothing more goes to this client." : "Contact allowed again." };
      }
      case "make_coi": {
        const made = await generateClientCoi({ customerId: id, holderName: value ?? "" });
        return made.ok ? { ok: true, message: "Certificate made. Open it under Certificates of insurance to send it." } : { ok: false, error: made.error };
      }
    }
    return UNKNOWN;
  },
};

const messageHandler: EntityHandler = {
  kind: "admin.message",
  async load(ctx, id) {
    const m = await one(ctx.sb.from("client_message_log").select("id, customer_id, channel, kind, status, skip_reason, detail, body, created_at, customers(name)").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!m) return null;
    return {
      title: `${words(str(m.kind))} by ${str(m.channel) === "sms" ? "text" : "email"}`,
      subtitle: `${str((m.customers as Row | null)?.name) || "Client"} · ${day(str(m.created_at))}`,
      status: words(str(m.status)),
      fields: fields([
        ["Why it didn't go", m.skip_reason ? words(str(m.skip_reason)) : ""],
        ["Detail", m.detail],
        ["The words", m.body],
      ]),
      sections: m.customer_id ? [{ title: "Client", rows: [row(str((m.customers as Row | null)?.name) || "Client", "admin.customer", m.customer_id)] }] : undefined,
      actions: [],
      note: "A record of what was sent. Messages go out from the automations and the client's own thread.",
    };
  },
};

const coiHandler: EntityHandler = {
  kind: "admin.coi",
  async load(ctx, id) {
    const c = await one(ctx.admin.from("client_cois").select("id, customer_id, holder_name, holder_address, additional_insured, created_at, sent_at, sent_to, customers(name)").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!c) return null;
    return {
      title: `Certificate for ${str(c.holder_name)}`,
      subtitle: str((c.customers as Row | null)?.name) || "Client",
      status: c.sent_at ? "Sent" : "Not sent",
      fields: fields([
        ["Holder address", c.holder_address],
        ["Additional insured", c.additional_insured ? "Yes" : "No"],
        ["Made", day(str(c.created_at))],
        ["Sent", c.sent_at ? `${day(str(c.sent_at))} to ${str(c.sent_to)}` : ""],
      ]),
      sections: [{ title: "Client", rows: [row(str((c.customers as Row | null)?.name) || "Client", "admin.customer", c.customer_id)] }],
      actions: [
        { id: "send", label: c.sent_at ? "Send again" : "Email it to the client", tone: "primary", confirm: "Email this certificate to the client?" },
        { id: "link", label: "Get a link to the PDF" },
      ],
    };
  },
  async act(_ctx, id, action) {
    if (action === "send") return result(await sendClientCoi(id), "Sent.");
    if (action === "link") {
      const r = await openClientCoi(id);
      return r.ok ? { ok: true, message: `Good for 10 minutes: ${r.url}` } : { ok: false, error: r.error };
    }
    return UNKNOWN;
  },
};

/* ------------------------------------------------------------------ */
/* Jobs and what the alerts point at                                    */
/* ------------------------------------------------------------------ */

const jobHandler: EntityHandler = {
  kind: "admin.job",
  async load(ctx, id) {
    const sb = ctx.sb;
    const j = await one(sb.from("jobs").select("id, name, job_number, status, evaluation_status, evaluation_date, assigned_to, property_id, created_at, completed_at, project_start_date, project_end_date, cancellation_reason").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!j) return null;
    const [property, proposal, invoices, payments, sessions, issues, assignee] = await Promise.all([
      j.property_id ? one(sb.from("properties").select("address, customer_id, customers(id, name)").eq("id", str(j.property_id))) : Promise.resolve(null),
      one(sb.from("job_proposals").select("status, total_cost, discount_amount, sent_at").eq("job_id", id).eq("organization_id", ctx.organizationId)),
      many(sb.from("invoices").select("id, amount, status, created_at").eq("job_id", id).order("created_at", { ascending: false })),
      many(sb.from("payments").select("id, amount_cents, method, received_at").eq("job_id", id).eq("organization_id", ctx.organizationId).order("received_at", { ascending: false })),
      many(sb.from("job_work_sessions").select("id, starts_on, status, purpose").eq("job_id", id).order("starts_on", { ascending: false }).limit(25)),
      many(sb.from("job_issues").select("id, title, status, created_at").eq("job_id", id).order("created_at", { ascending: false }).limit(25)),
      j.assigned_to ? one(sb.from("profiles").select("full_name, first_name, last_name, email").eq("id", str(j.assigned_to))) : Promise.resolve(null),
    ]);
    const customer = (property?.customers as Row | null) ?? null;
    const live = invoices.find((i) => i.status !== "void");
    const pStatus = str(proposal?.status);

    const actions: EntityAction[] = [];
    if (pStatus === "needs_approval") {
      actions.push({ id: "accept_price", label: `Accept the price (${usd(num(proposal?.total_cost))})`, tone: "primary" });
      // Where "Not this price" in the approval queue sends the owner to type the right one.
      actions.push({ id: "set_price", label: "Approve at a different price", input: { type: "number", label: "Total, in dollars", initial: String(Math.round(num(proposal?.total_cost) - num(proposal?.discount_amount))), required: true } });
    }
    if (!live && (pStatus === "accepted" || j.status === "approved") && j.status !== "cancelled") {
      actions.push({ id: "raise_invoice", label: "Send the invoice", tone: "primary", confirm: "Raise the invoice and text the client the payment link?" });
    }
    if (j.status === "completed") actions.push({ id: "recompute_cost", label: "Recalculate the job cost" });
    if (j.evaluation_status === "scheduled") {
      actions.push({ id: "cancel_eval", label: "Cancel the evaluation", tone: "danger", confirm: "Cancel this evaluation?", input: { type: "textarea", label: "Why", placeholder: "The client called to cancel" } });
    }

    return {
      title: str(j.name) || "Job",
      subtitle: [j.job_number ? `#${str(j.job_number)}` : "", str(customer?.name)].filter(Boolean).join(" · ") || undefined,
      status: words(str(j.status)),
      fields: fields([
        ["Address", property?.address],
        ["Evaluation", j.evaluation_status ? `${words(str(j.evaluation_status))}${j.evaluation_date ? ` · ${day(str(j.evaluation_date))}` : ""}` : ""],
        ["Assigned to", assignee ? personName(assignee) : ""],
        ["Proposal", proposal ? `${words(pStatus)} · ${usd(num(proposal.total_cost) - num(proposal.discount_amount))}` : "None yet"],
        ["Work dates", j.project_start_date ? `${day(str(j.project_start_date))} to ${day(str(j.project_end_date))}` : ""],
        ["Finished", j.completed_at ? day(str(j.completed_at)) : ""],
        ["Cancelled because", j.cancellation_reason],
      ]),
      sections: [
        { title: "Client", rows: customer ? [row(str(customer.name) || "Client", "admin.customer", customer.id)] : [], empty: "No client on this job." },
        { title: "Invoices", rows: invoices.map((i) => row(`${day(str(i.created_at))} · ${usd(num(i.amount))} · ${words(str(i.status))}`, "admin.invoice", i.id)), empty: "No invoice yet." },
        { title: "Payments", rows: payments.map((p) => row(`${day(str(p.received_at))} · ${usd(num(p.amount_cents) / 100)} · ${words(str(p.method))}`, "admin.payment", p.id)), empty: "No payments." },
        { title: "Work days", rows: sessions.map((s) => row(`${day(str(s.starts_on))} · ${words(str(s.status))}${s.purpose ? ` · ${str(s.purpose)}` : ""}`, "admin.work_day", s.id)), empty: "None scheduled." },
        { title: "Issues", rows: issues.map((i) => row(`${str(i.title) || "Issue"} · ${words(str(i.status))}`, "admin.job_issue", i.id)), empty: "No issues." },
      ],
      actions,
    };
  },
  async act(ctx, id, action, value) {
    const j = await one(ctx.sb.from("jobs").select("id").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!j) return { ok: false, error: "Couldn't find that job." };
    switch (action) {
      case "accept_price": {
        const r = await acceptPrice(id);
        return r.ok ? { ok: true, message: "Price accepted. Send it to the client from the job." } : { ok: false, error: r.error };
      }
      case "set_price": {
        const total = Number(value);
        const r = await setPrice(id, total);
        return r.ok ? { ok: true, message: `Approved at ${usd(total)}. Send it to the client from the job.` } : { ok: false, error: r.error };
      }
      case "raise_invoice":
        return result(await raiseInvoiceForJob(id));
      case "recompute_cost":
        return result(await recomputeJobCost(id));
      case "cancel_eval":
        return result(await cancelEstimate(id, value ?? null), "Evaluation cancelled.");
    }
    return UNKNOWN;
  },
};

const OPEN_SESSION = ["scheduled", "in_progress", "paused"];

const workDayHandler: EntityHandler = {
  kind: "admin.work_day",
  async load(ctx, id) {
    const s = await one(ctx.sb.from("job_work_sessions").select("id, job_id, starts_on, ends_on, status, purpose, pause_reason, closed_at, jobs(name)").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!s) return null;
    const open = OPEN_SESSION.includes(str(s.status));
    return {
      title: `Work day ${day(str(s.starts_on))}`,
      subtitle: str((s.jobs as Row | null)?.name) || undefined,
      status: words(str(s.status)),
      fields: fields([
        ["Ends", s.ends_on && s.ends_on !== s.starts_on ? day(str(s.ends_on)) : ""],
        ["For", s.purpose],
        ["Paused because", s.pause_reason],
        ["Closed", s.closed_at ? day(str(s.closed_at)) : ""],
      ]),
      sections: [{ title: "Job", rows: [row(str((s.jobs as Row | null)?.name) || "Job", "admin.job", s.job_id)] }],
      actions: open
        ? [
            { id: "done", label: "Mark done", tone: "primary" },
            { id: "cancelled", label: "Mark cancelled", tone: "danger", confirm: "Close this work day as cancelled?" },
          ]
        : [],
      note: open ? undefined : "This day is closed.",
    };
  },
  async act(ctx, id, action) {
    if (action !== "done" && action !== "cancelled") return UNKNOWN;
    const s = await one(ctx.sb.from("job_work_sessions").select("id").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!s) return { ok: false, error: "Couldn't find that day." };
    return result(await closeOneSession(id, action));
  },
};

const socialPostHandler: EntityHandler = {
  kind: "admin.social_post",
  async load(ctx, id) {
    const p = await one(ctx.sb.from("social_posts").select("id, job_id, kind, status, hook, caption, body, channel, scheduled_for, posted_at, jobs(name)").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!p) return null;
    const waiting = p.status === "scheduled" || p.status === "draft";
    return {
      title: (str(p.hook) || words(str(p.kind))).slice(0, 80),
      subtitle: p.scheduled_for ? `For ${day(str(p.scheduled_for))}` : undefined,
      status: words(str(p.status)),
      fields: fields([
        ["Caption", p.caption || p.body],
        ["Channel", p.channel],
        ["Posted", p.posted_at ? day(str(p.posted_at)) : ""],
      ]),
      sections: p.job_id ? [{ title: "Job", rows: [row(str((p.jobs as Row | null)?.name) || "Job", "admin.job", p.job_id)] }] : undefined,
      actions: waiting
        ? [
            { id: "posted", label: "Mark as posted", tone: "primary" },
            ...(p.status === "scheduled" ? [{ id: "skip", label: "Don't post it", tone: "danger" as const, input: DECLINE_INPUT }] : []),
          ]
        : [],
    };
  },
  async act(ctx, id, action, value) {
    const p = await one(ctx.sb.from("social_posts").select("id").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!p) return { ok: false, error: "Couldn't find that post." };
    if (action === "posted") return result(await markPosted(id));
    if (action === "skip") return result(await declineQueueItem("social", id, value ?? ""));
    return UNKNOWN;
  },
};

const materialHandler: EntityHandler = {
  kind: "admin.material",
  async load(ctx, id) {
    const m = await one(ctx.sb.from("materials").select("id, name, unit, category, quantity_on_hand, reorder_threshold, reorder_quantity, on_order, cost_per_unit, storage_location, active").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!m) return null;
    const unit = str(m.unit);
    return {
      title: str(m.name) || "Material",
      subtitle: words(str(m.category)),
      status: m.on_order ? "On order" : m.active === false ? "Not used any more" : undefined,
      fields: fields([
        ["On hand", m.quantity_on_hand == null ? "Not counted" : `${num(m.quantity_on_hand)} ${unit}`],
        ["Reorder at", m.reorder_threshold == null ? "" : `${num(m.reorder_threshold)} ${unit}`],
        ["Reorder", m.reorder_quantity == null ? "" : `${num(m.reorder_quantity)} ${unit}`],
        ["Cost", m.cost_per_unit == null ? "" : `${usd(num(m.cost_per_unit))} per ${unit || "unit"}`],
        ["Kept at", m.storage_location],
      ]),
      actions: [
        { id: "qty", label: "Count on hand", tone: "primary", input: { type: "number", label: `On hand${unit ? ` (${unit})` : ""}`, initial: m.quantity_on_hand == null ? "" : String(m.quantity_on_hand) } },
        { id: "threshold", label: "Change reorder point", input: { type: "number", label: "Reorder when below", initial: m.reorder_threshold == null ? "" : String(m.reorder_threshold) } },
        m.on_order ? { id: "not_ordered", label: "Not on order" } : { id: "ordered", label: "Mark on order" },
      ],
    };
  },
  async act(ctx, id, action, value) {
    const m = await one(ctx.sb.from("materials").select("id").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!m) return { ok: false, error: "Couldn't find that material." };
    const n = value == null || value.trim() === "" ? null : Number(value);
    if (n != null && !Number.isFinite(n)) return { ok: false, error: "That isn't a number." };
    switch (action) {
      case "qty":
        return attempt(() => updateMaterialQuantityOnHand(id, n), "Count saved.");
      case "threshold":
        return attempt(() => updateMaterialReorderThreshold(id, n), "Reorder point saved.");
      case "ordered":
      case "not_ordered":
        return attempt(() => setMaterialOnOrder(id, action === "ordered"), action === "ordered" ? "Marked on order." : "Taken off order.");
    }
    return UNKNOWN;
  },
};

const fleetHandler: EntityHandler = {
  kind: "admin.fleet_asset",
  async load(ctx, id) {
    const f = await one(ctx.sb.from("fleet_assets").select("id, name, kind, make, model, year, condition, breakdowns_12mo, last_breakdown_on, mileage, engine_hours, notes, retired_on").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!f) return null;
    return {
      title: str(f.name) || "Vehicle",
      subtitle: [words(str(f.kind)), str(f.year), str(f.make), str(f.model)].filter((x) => x && x !== "—").join(" ") || undefined,
      status: f.retired_on ? "Retired" : words(str(f.condition)),
      fields: fields([
        ["Breakdowns, 12 months", f.breakdowns_12mo],
        ["Last breakdown", f.last_breakdown_on ? day(str(f.last_breakdown_on)) : ""],
        ["Mileage", f.mileage],
        ["Engine hours", f.engine_hours],
        ["Notes", f.notes],
      ]),
      actions: f.retired_on
        ? [{ id: "unretire", label: "Bring back into use" }]
        : [{ id: "retire", label: "Retire it", tone: "danger", confirm: "Take this out of the fleet?" }],
    };
  },
  async act(ctx, id, action) {
    if (action !== "retire" && action !== "unretire") return UNKNOWN;
    const f = await one(ctx.sb.from("fleet_assets").select("id").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!f) return { ok: false, error: "Couldn't find that." };
    return result(await retireAsset({ id, retired: action === "retire" }), action === "retire" ? "Retired." : "Back in use.");
  },
};

const issueHandler: EntityHandler = {
  kind: "admin.job_issue",
  async load(ctx, id) {
    const i = await one(ctx.sb.from("job_issues").select("id, job_id, title, type, severity, status, description, blocking, resolution, prevention, created_at, resolved_at, jobs(name)").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!i) return null;
    const open = i.status !== "resolved";
    return {
      title: str(i.title) || "Issue",
      subtitle: `${words(str(i.type))} · raised ${day(str(i.created_at))}`,
      status: words(str(i.status)),
      fields: fields([
        ["Severity", words(str(i.severity))],
        ["Stops the job", i.blocking ? "Yes" : ""],
        ["What happened", i.description],
        ["What was done", i.resolution],
        ["So it can't happen again", i.prevention],
      ]),
      sections: i.job_id ? [{ title: "Job", rows: [row(str((i.jobs as Row | null)?.name) || "Job", "admin.job", i.job_id)] }] : undefined,
      actions: open
        ? [{ id: "resolve", label: "Resolve", tone: "primary", input: { type: "textarea", label: "First line: what was done. Then: what changes so it can't happen again.", required: true } }]
        : [],
    };
  },
  async act(ctx, id, action, value) {
    if (action !== "resolve") return UNKNOWN;
    const i = await one(ctx.sb.from("job_issues").select("id, job_id").eq("id", id).eq("organization_id", ctx.organizationId));
    if (!i) return { ok: false, error: "Couldn't find that issue." };
    const { resolution, prevention } = splitResolution(value);
    return result(await resolveIssue({ issueId: id, jobId: str(i.job_id), resolution, prevention }), "Resolved.");
  },
};

export const ADMIN_ACCOUNT_HANDLERS: EntityHandler[] = [
  alertHandler,
  queueItemHandler,
  customerHandler,
  messageHandler,
  coiHandler,
  jobHandler,
  workDayHandler,
  socialPostHandler,
  materialHandler,
  fleetHandler,
  issueHandler,
];

import { row, type ActionResult, type EntityAction, type EntityContext, type EntityHandler, type EntityRow, type EntityView } from "@/lib/entities/types";
import {
  EXTEND_DAY_OPTIONS,
  JOB_STATUS_CHOICES,
  NO_SHOW_REASON,
  cancelReason,
  dollars,
  extendedExpiry,
  movedEnd,
  parseVisitTime,
  planStatusChange,
  proposalActionsFor,
  readAreaList,
  salesDay,
  salesWhen,
  startsRebook,
  statusWords,
  suggestPhaseOne,
  visitTimeText,
  type ProposalActionId,
} from "@/lib/entities/sales-rules";
import { cancelEstimate, cancelJob, reassignEvaluator, reopenJob, scheduleEstimate, updateJobStatus } from "@/lib/actions/job-actions";
import { closeJob } from "@/lib/actions/pipeline-move-actions";
import { postJobMessage } from "@/lib/actions/job-message-actions";
import { acceptPrice, setPrice } from "@/lib/actions/price-approval-actions";
import { sendProposalToClient } from "@/lib/actions/proposal-actions";
import { respondToProposal } from "@/lib/actions/public-proposal-actions";
import { makePhaseOne } from "@/lib/actions/win-back-actions";
import { approveOutbound, declineOutbound } from "@/lib/actions/outbound-approval-actions";
import { updateCustomerContact } from "@/lib/actions/customer-actions";
import { saveTerritory } from "@/lib/actions/territory-actions";
import { setDoesEvaluations } from "@/lib/actions/team-actions";
import { setServiceRate } from "@/lib/actions/sales-autopilot-actions";
import { askForVisit, markPhotoQuotePriced } from "@/lib/actions/photo-quote-actions";
import { cleanAnswers } from "@/lib/evaluation-intake";
import { markPaymentCollected } from "@/lib/actions/collect-payment-actions";
import { reissueInvoiceForJob } from "@/lib/actions/job-invoice-actions";
import { reopenOfficeDeclined } from "@/lib/data/decline-proposals";
import { loadTerritories } from "@/lib/data/territories";
import { loadScorecard } from "@/lib/data/sales-panels";
import { DECLINE_REASON_LABEL, DECLINE_REASONS, isDeclineReason } from "@/lib/approvals/declines";
import { HOLD_REASON_LABEL } from "@/lib/approvals/policy";
import { isCollectMethod, offlineMethodLabel, type CollectMethod } from "@/lib/collect-payment";
import { EXPIRED_REASON, isExpired } from "@/lib/proposal-validity";
import { OUTCOME_LABEL } from "@/lib/call-list";
import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * What can be opened and done from the Sales page's lists: a job's sales
 * view, an evaluation visit, a proposal, a client, an evaluator, an invoice,
 * a held email, a priced service and a photo quote.
 *
 * Every read is scoped to the owner's business. Every write goes through the
 * action the rest of the app already uses for it, so the checks, the
 * calendar sync, the messages and the revalidation are the same ones.
 */

type Row = Record<string, unknown>;

const str = (x: unknown) => (typeof x === "string" ? x : "");
const num = (x: unknown) => (typeof x === "number" ? x : Number(x ?? 0) || 0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (x: unknown): x is string => typeof x === "string" && UUID.test(x);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** "12 Haystack Court, Forest Hill, MD 21050" → "12 Haystack Court, Forest Hill" */
const place = (address: unknown) => {
  const parts = str(address).split(",").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? `${parts[0]}, ${parts[1]}` : parts[0] || "No address";
};

const fail = (error: string): ActionResult => ({ ok: false, error });
const done = (message?: string): ActionResult => ({ ok: true, message });
const fromJobResult = (r: { ok: true; message?: string } | { ok: false; message: string }): ActionResult => (r.ok ? done(r.message) : fail(r.message));
const errText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

async function attempt(fn: () => Promise<ActionResult>, fallback: string): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    return fail(errText(err, fallback));
  }
}

/* ------------------------------------------------------------------ */
/* Shared reads, each scoped to the business                           */
/* ------------------------------------------------------------------ */

const CUSTOMER_COLS = "id,name,email,phone,do_not_contact,organization_id";
const JOB_COLS =
  "id,name,status,evaluation_status,evaluation_date,evaluation_end_date,evaluation_submitted_at,assigned_to,referral_code,cancellation_reason,cancelled_at,declined_at,declined_reason,client_notes,budget_range,created_at,project_start_date," +
  `property:properties!inner(id,address,customer:customers!inner(${CUSTOMER_COLS}))`;

async function ownJob(ctx: EntityContext, id: string): Promise<Row | null> {
  if (!isId(id)) return null;
  const { data } = await ctx.sb.from("jobs").select(JOB_COLS).eq("id", id).eq("property.customer.organization_id", ctx.organizationId).maybeSingle();
  return (data as Row | null) ?? null;
}

const customerOfJob = (job: Row): Row => (((job.property as Row | null)?.customer as Row | null) ?? {}) as Row;
const addressOfJob = (job: Row): string => str((job.property as Row | null)?.address);

async function profileName(ctx: EntityContext, id: unknown): Promise<string> {
  if (!isId(id)) return "Unassigned";
  const { data } = await ctx.sb.from("profiles").select("full_name,email").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
  return data ? str(data.full_name) || str(data.email) : "Somebody";
}

/** Everybody who can be given an evaluation, for the reassign picker. */
async function evaluatorOptions(ctx: EntityContext, current: unknown): Promise<{ value: string; label: string }[]> {
  const { data } = await ctx.sb.from("profiles").select("id,full_name,email,does_evaluations").eq("organization_id", ctx.organizationId).order("full_name");
  const people = ((data ?? []) as Row[]).filter((p) => p.does_evaluations || p.id === current);
  return [{ value: "none", label: "Nobody (unassigned)" }, ...people.map((p) => ({ value: str(p.id), label: str(p.full_name) || str(p.email) }))];
}

async function proposalOfJob(ctx: EntityContext, jobId: string): Promise<Row | null> {
  const { data } = await ctx.sb
    .from("job_proposals")
    .select("id,status,total_cost,discount_amount,sent_at,approved_at,expires_at,office_declined_from")
    .eq("job_id", jobId)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

async function heldFor(ctx: EntityContext, column: "job_id" | "customer_id", id: string): Promise<EntityRow[]> {
  const { data } = await ctx.sb
    .from("outbound_approvals")
    .select("id,subject,kind,created_at")
    .eq("organization_id", ctx.organizationId)
    .eq(column, id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(10);
  return ((data ?? []) as Row[]).map((a) => row(`${str(a.subject) || statusWords(str(a.kind))} · held ${salesDay(str(a.created_at))}`, "sales.approval", a.id));
}

const proposalRowText = (p: Row) => `${statusWords(str(p.status))} · ${dollars(num(p.total_cost) - num(p.discount_amount))}${p.expires_at && p.status === "sent" ? ` · expires ${salesDay(str(p.expires_at))}` : ""}`;

/** Stop every automated message to a client: the do-not-contact mark every sender checks. */
async function setDoNotContact(ctx: EntityContext, customerId: unknown, value: boolean): Promise<ActionResult> {
  if (!isId(customerId)) return fail("There's no client on this.");
  const { error } = await ctx.sb.from("customers").update({ do_not_contact: value }).eq("id", customerId).eq("organization_id", ctx.organizationId);
  if (error) return fail(error.message);
  return done(value ? "Marked do not contact. No automated message will go to them." : "They can be contacted again.");
}

const stopAction = (customer: Row): EntityAction =>
  customer.do_not_contact
    ? { id: "allow_messages", label: "Allow messages again", confirm: "Let automated messages reach this client again?" }
    : { id: "stop_messages", label: "Stop messages for this person", tone: "danger", confirm: "Mark this client do-not-contact? No automated text or email will go to them." };

/* ------------------------------------------------------------------ */
/* sales.job: a lead or job's sales view                               */
/* ------------------------------------------------------------------ */

const job: EntityHandler = {
  kind: "sales.job",
  async load(ctx, id) {
    const j = await ownJob(ctx, id);
    if (!j) return null;
    const c = customerOfJob(j);
    const [evaluator, proposal, notes, invoices, held] = await Promise.all([
      profileName(ctx, j.assigned_to),
      proposalOfJob(ctx, id),
      ctx.sb.from("job_messages").select("author_name,body,channel,created_at").eq("job_id", id).eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(8),
      ctx.sb.from("invoices").select("id,amount,status,created_at").eq("job_id", id).eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(10),
      heldFor(ctx, "job_id", id),
    ]);
    const evalRow = j.evaluation_date
      ? row(`${salesWhen(str(j.evaluation_date))} · ${statusWords(str(j.evaluation_status))} · ${evaluator}`, "sales.evaluation", j.id)
      : row("No visit booked · book one", "sales.evaluation", j.id);
    const fields = [
      { label: "Client", value: str(c.name) || "Unnamed client" },
      { label: "Address", value: addressOfJob(j) },
      { label: "Status", value: statusWords(str(j.status)) },
      { label: "Evaluation", value: j.evaluation_date ? `${salesWhen(str(j.evaluation_date))} (${statusWords(str(j.evaluation_status))})` : "Not booked" },
      { label: "Evaluator", value: evaluator },
      { label: "Proposal", value: proposal ? proposalRowText(proposal) : "None yet" },
      { label: "Created", value: salesDay(str(j.created_at)) },
    ];
    if (j.referral_code) fields.push({ label: "Referral code", value: str(j.referral_code) });
    if (j.budget_range) fields.push({ label: "Budget", value: str(j.budget_range) });
    if (j.client_notes) fields.push({ label: "Client's notes", value: str(j.client_notes) });
    if (j.declined_at) fields.push({ label: "Declined", value: `${salesDay(str(j.declined_at))}${j.declined_reason ? `: ${str(j.declined_reason)}` : ""}` });
    if (j.cancelled_at) fields.push({ label: "Cancelled", value: `${salesDay(str(j.cancelled_at))}${j.cancellation_reason ? `: ${str(j.cancellation_reason)}` : ""}` });

    const view: EntityView = {
      title: place(addressOfJob(j)) || str(j.name),
      subtitle: str(c.name) || undefined,
      status: statusWords(str(j.status)),
      fields,
      sections: [
        { title: "Client", rows: [row(`${str(c.name) || "Unnamed client"}${c.do_not_contact ? " · do not contact" : ""}`, "sales.client", c.id)] },
        { title: "Evaluation", rows: [evalRow] },
        { title: "Proposal", rows: proposal ? [row(proposalRowText(proposal), "sales.proposal", proposal.id)] : [], empty: "No proposal yet. It is written when the evaluation is submitted." },
        {
          title: "Invoices",
          rows: ((invoices.data ?? []) as Row[]).map((i) => row(`${dollars(num(i.amount))} · ${statusWords(str(i.status))} · ${salesDay(str(i.created_at))}`, "sales.invoice", i.id)),
          empty: "No invoice.",
        },
        { title: "Emails held for you", rows: held, empty: "Nothing held." },
        {
          title: "Notes and messages",
          rows: ((notes.data ?? []) as Row[]).map((m) => ({
            text: `${salesDay(str(m.created_at))} · ${str(m.author_name)}${m.channel === "internal" ? " (note)" : ""}: ${str(m.body).slice(0, 160)}`,
          })),
          empty: "Nothing written on this job yet.",
        },
      ],
      actions: [
        {
          id: "status",
          label: "Change status",
          input: { type: "select", label: "Status", options: JOB_STATUS_CHOICES, initial: str(j.status), required: true },
        },
        {
          id: "reassign",
          label: "Reassign evaluator",
          input: { type: "select", label: "Evaluator", options: await evaluatorOptions(ctx, j.assigned_to), initial: isId(j.assigned_to) ? j.assigned_to : "none", required: true },
        },
        { id: "note", label: "Add a note", tone: "primary", input: { type: "textarea", label: "Note (team only)", placeholder: "What happened, what's next", required: true } },
        stopAction(c),
      ],
      note: "Cancelling clears the work dates but keeps the proposal and messages, so reopening brings it all back. Notes are for the team only; the client never sees them.",
    };
    return view;
  },
  async act(ctx, id, action, value) {
    const j = await ownJob(ctx, id);
    if (!j) return fail("That job isn't there any more.");
    switch (action) {
      case "status": {
        const plan = planStatusChange(str(j.status), value ?? "");
        if (!plan.ok) return fail(plan.error);
        if (plan.via === "cancel") return fromJobResult(await cancelJob(id, "Cancelled from Sales."));
        return attempt(async () => {
          if (plan.via === "reopen_then_set") {
            const reopened = await reopenJob(id);
            if (!reopened.ok) return fail(reopened.message);
          }
          await updateJobStatus(id, plan.status);
          return done(`Now ${statusWords(plan.status).toLowerCase()}.`);
        }, "Couldn't change the status.");
      }
      case "reassign": {
        const to = value === "none" ? null : value;
        if (to !== null && !isId(to)) return fail("Pick somebody.");
        return fromJobResult(await reassignEvaluator(id, to ?? null));
      }
      case "note": {
        const body = (value ?? "").trim();
        if (!body) return fail("Write the note first.");
        return attempt(async () => {
          await postJobMessage(id, "internal", body);
          return done("Note added.");
        }, "Couldn't add that note.");
      }
      case "stop_messages":
        return setDoNotContact(ctx, customerOfJob(j).id, true);
      case "allow_messages":
        return setDoNotContact(ctx, customerOfJob(j).id, false);
    }
    return fail("That can't be done here.");
  },
};

/* ------------------------------------------------------------------ */
/* sales.evaluation: the visit, keyed by its job                       */
/* ------------------------------------------------------------------ */

const evaluation: EntityHandler = {
  kind: "sales.evaluation",
  async load(ctx, id) {
    const j = await ownJob(ctx, id);
    if (!j) return null;
    const c = customerOfJob(j);
    const [evaluator, intake, options] = await Promise.all([
      profileName(ctx, j.assigned_to),
      ctx.sb.from("evaluation_intakes").select("submitted_at,answers").eq("job_id", id).eq("organization_id", ctx.organizationId).maybeSingle(),
      evaluatorOptions(ctx, j.assigned_to),
    ]);
    const evStatus = str(j.evaluation_status);
    const live = Boolean(j.evaluation_date) && evStatus !== "completed" && evStatus !== "cancelled" && j.status !== "cancelled";
    const answers = intake.data?.answers && typeof intake.data.answers === "object" ? Object.entries(intake.data.answers as Row) : [];
    const actions: EntityAction[] = [];
    if (evStatus !== "completed" && j.status !== "cancelled") {
      actions.push({
        id: "reschedule",
        label: j.evaluation_date ? "Reschedule" : "Book the visit",
        tone: "primary",
        input: { type: "text", label: "New time (YYYY-MM-DD HH:MM, Eastern)", placeholder: "2026-10-20 14:30", initial: visitTimeText(str(j.evaluation_date)), required: true },
      });
    }
    actions.push({
      id: "reassign",
      label: "Reassign",
      input: { type: "select", label: "Evaluator", options, initial: isId(j.assigned_to) ? j.assigned_to : "none", required: true },
    });
    if (live) {
      actions.push(
        { id: "no_show", label: "Mark no-show", tone: "danger", confirm: "Mark this visit as a no-show? It comes off the calendar and, if rebooking is on, the client is sent a link to pick a new time." },
        { id: "cancel", label: "Cancel visit", tone: "danger", confirm: "Cancel this visit?", input: { type: "textarea", label: "Why (say 'client cancelled' if it was them)", required: true } }
      );
    }
    actions.push(stopAction(c));
    return {
      title: `Evaluation · ${place(addressOfJob(j))}`,
      subtitle: str(c.name) || undefined,
      status: j.evaluation_date ? statusWords(evStatus) : "Not booked",
      fields: [
        { label: "When", value: salesWhen(str(j.evaluation_date)) },
        { label: "Evaluator", value: evaluator },
        { label: "Client", value: str(c.name) || "Unnamed client" },
        { label: "Phone", value: str(c.phone) },
        { label: "Email", value: str(c.email) },
        { label: "Address", value: addressOfJob(j) },
        { label: "Pre-visit questions", value: intake.data ? (intake.data.submitted_at ? `Answered ${salesDay(str(intake.data.submitted_at))}` : "Sent, not answered") : "Not sent" },
        ...(evStatus === "cancelled" && j.cancellation_reason ? [{ label: "Cancelled because", value: str(j.cancellation_reason) }] : []),
      ],
      sections: [
        { title: "Job", rows: [row(`${str(j.name) || place(addressOfJob(j))} · ${statusWords(str(j.status))}`, "sales.job", j.id)] },
        { title: "Client", rows: [row(str(c.name) || "Unnamed client", "sales.client", c.id)] },
        { title: "Their answers", rows: answers.slice(0, 12).map(([k, v]) => ({ text: `${statusWords(k)}: ${typeof v === "string" ? v : JSON.stringify(v)}`.slice(0, 200) })), empty: "No answers yet." },
      ],
      actions,
      note: live
        ? "Moving or reassigning follows the visit onto the calendar and GoHighLevel, checks for a double booking, and tells the evaluators. A no-show starts the rebook messages if they are switched on."
        : evStatus === "completed"
          ? "This visit happened. Its proposal is on the job."
          : undefined,
    };
  },
  async act(ctx, id, action, value) {
    const j = await ownJob(ctx, id);
    if (!j) return fail("That visit isn't there any more.");
    switch (action) {
      case "reschedule": {
        const at = parseVisitTime(value);
        if (!at) return fail("Type the time as 2026-10-20 14:30.");
        if (at.getTime() < Date.now() - 60 * 60_000) return fail("That time has passed.");
        return fromJobResult(await scheduleEstimate(id, at.toISOString(), movedEnd(str(j.evaluation_date) || null, str(j.evaluation_end_date) || null, at)));
      }
      case "reassign": {
        const to = value === "none" ? null : value;
        if (to !== null && !isId(to)) return fail("Pick somebody.");
        return fromJobResult(await reassignEvaluator(id, to ?? null));
      }
      case "no_show": {
        const r = await cancelEstimate(id, NO_SHOW_REASON);
        if (!r.ok) return fail(r.message);
        return done(startsRebook(NO_SHOW_REASON) ? "Marked a no-show. The rebook link goes out if rebooking is switched on." : "Marked a no-show.");
      }
      case "cancel": {
        const reason = cancelReason(value);
        if (!reason) return fail("Say why it was cancelled.");
        return fromJobResult(await cancelEstimate(id, reason));
      }
      case "stop_messages":
        return setDoNotContact(ctx, customerOfJob(j).id, true);
      case "allow_messages":
        return setDoNotContact(ctx, customerOfJob(j).id, false);
    }
    return fail("That can't be done here.");
  },
};

/* ------------------------------------------------------------------ */
/* sales.proposal                                                       */
/* ------------------------------------------------------------------ */

async function ownProposal(ctx: EntityContext, id: string): Promise<Row | null> {
  if (!isId(id)) return null;
  const { data } = await ctx.sb
    .from("job_proposals")
    .select("id,job_id,token,status,total_cost,discount_amount,discount_reason,sent_at,approved_at,responded_at,expires_at,valid_days,client_response_note,office_declined_from,scope_snapshot,created_at")
    .eq("id", id)
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

const areasOf = (p: Row) => ((Array.isArray(p.scope_snapshot) ? p.scope_snapshot : []) as ProposalZoneSnapshot[]).filter((z) => z && typeof z.zoneName === "string");
const areaCents = (z: ProposalZoneSnapshot) => {
  const c = (z as unknown as { priceCents?: unknown }).priceCents;
  return typeof c === "number" ? c : null;
};

const proposal: EntityHandler = {
  kind: "sales.proposal",
  async load(ctx, id) {
    const p = await ownProposal(ctx, id);
    if (!p) return null;
    const jobId = str(p.job_id);
    const j = await ownJob(ctx, jobId);
    if (!j) return null;
    const c = customerOfJob(j);
    const [views, calls, held] = await Promise.all([
      ctx.sb.from("proposal_views").select("*", { count: "exact", head: true }).eq("proposal_id", id),
      ctx.sb.from("proposal_calls").select("outcome,note,created_at").eq("proposal_id", id).eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(8),
      heldFor(ctx, "job_id", jobId),
    ]);
    const now = new Date();
    const expired = isExpired(str(p.expires_at) || null, now) || (p.status === "declined" && j.declined_reason === EXPIRED_REASON);
    const status = str(p.status);
    const areas = areasOf(p);
    const total = num(p.total_cost) - num(p.discount_amount);
    const can = proposalActionsFor({ status, approvedAt: str(p.approved_at) || null, expired, officeDeclinedFrom: str(p.office_declined_from) || null });
    const defs: Record<ProposalActionId, EntityAction> = {
      approve: { id: "approve", label: `Approve price (${dollars(total)})`, tone: "primary", confirm: `Approve this proposal at ${dollars(total)}? It goes live on its link; Resend sends the email.` },
      set_price: { id: "set_price", label: "Approve at a different price", input: { type: "number", label: "Total, in dollars", initial: String(Math.round(total)), required: true } },
      resend: { id: "resend", label: "Resend to client", tone: "primary", confirm: `Email the proposal to ${str(c.email) || "the client"} again?` },
      extend: {
        id: "extend",
        label: status === "declined" ? "Reopen and extend" : "Extend expiry",
        input: { type: "select", label: "Extend by", options: EXTEND_DAY_OPTIONS.map((d) => ({ value: String(d), label: `${d} days` })), initial: "7", required: true },
      },
      accept: { id: "accept", label: "Mark accepted", confirm: "Mark this proposal accepted, as if the client had signed? The job is approved and the deposit invoice goes to them." },
      decline: { id: "decline", label: "Mark declined", tone: "danger", confirm: "Mark this proposal declined? The job leaves the live lists.", input: { type: "textarea", label: "What they said", required: false } },
      win_back: {
        id: "win_back",
        label: "Start win-back (Phase 1)",
        input: {
          type: "textarea",
          label: `Areas to offer now, one per line (of: ${areas.map((a) => a.zoneName).join(", ") || "none"})`,
          initial: suggestPhaseOne(areas.map((a) => ({ name: a.zoneName, cents: areaCents(a) }))).join("\n"),
          required: true,
        },
      },
      stop_messages: stopAction(c),
    };
    return {
      title: `Proposal · ${place(addressOfJob(j))}`,
      subtitle: str(c.name) || undefined,
      status: expired && status === "sent" ? "Expired" : statusWords(status),
      fields: [
        { label: "Total", value: dollars(total) },
        ...(num(p.discount_amount) > 0 ? [{ label: "Discount", value: `${dollars(num(p.discount_amount))}${p.discount_reason ? ` (${str(p.discount_reason)})` : ""}` }] : []),
        { label: "Written", value: salesDay(str(p.created_at)) },
        { label: "Approved", value: salesDay(str(p.approved_at) || null) },
        { label: "Sent", value: salesDay(str(p.sent_at) || null) },
        { label: "Expires", value: salesDay(str(p.expires_at) || null) },
        { label: "Answered", value: p.responded_at ? `${salesDay(str(p.responded_at))}${p.client_response_note ? `: ${str(p.client_response_note)}` : ""}` : "Not yet" },
        { label: "Views", value: String(views.count ?? 0) },
      ],
      sections: [
        { title: "Job", rows: [row(`${str(j.name) || place(addressOfJob(j))} · ${statusWords(str(j.status))}`, "sales.job", j.id)] },
        { title: "Client", rows: [row(`${str(c.name) || "Unnamed client"}${c.do_not_contact ? " · do not contact" : ""}`, "sales.client", c.id)] },
        { title: "Areas", rows: areas.map((a) => ({ text: `${a.zoneName} · ${a.serviceLabel}${areaCents(a) != null ? ` · ${dollars(areaCents(a)! / 100)}` : ""}` })), empty: "No areas on it." },
        {
          title: "Calls about it",
          rows: ((calls.data ?? []) as Row[]).map((k) => ({ text: `${salesDay(str(k.created_at))} · ${OUTCOME_LABEL[str(k.outcome) as keyof typeof OUTCOME_LABEL] ?? statusWords(str(k.outcome))}${k.note ? `: ${str(k.note)}` : ""}` })),
          empty: "No calls logged.",
        },
        { title: "Emails held for you", rows: held, empty: "Nothing held." },
      ],
      actions: can.map((a) => defs[a]),
      note:
        status === "declined"
          ? "Win-back turns the declined proposal into a smaller Phase 1 at the areas' own prices, back in price approvals; nothing goes to the client until it is approved and sent."
          : "Approving makes it live on its link. Resend emails it through the usual sender, logged like any other.",
    };
  },
  async act(ctx, id, action, value) {
    const p = await ownProposal(ctx, id);
    if (!p) return fail("That proposal isn't there any more.");
    const jobId = str(p.job_id);
    const j = await ownJob(ctx, jobId);
    if (!j) return fail("That proposal's job isn't there any more.");
    switch (action) {
      case "approve": {
        const r = await acceptPrice(jobId);
        return r.ok ? done(r.sendTo ? `Approved. Resend emails it to ${r.sendTo}.` : "Approved. The client has no email on file: text them the link.") : fail(r.error);
      }
      case "set_price": {
        const total = Number(value);
        const r = await setPrice(jobId, total);
        return r.ok ? done(`Approved at ${dollars(total)}.`) : fail(r.error);
      }
      case "resend": {
        const r = await sendProposalToClient(jobId);
        return r.ok ? done(`Sent to ${r.to}.`) : fail(r.error);
      }
      case "extend": {
        const days = Number(value);
        if (!(EXTEND_DAY_OPTIONS as readonly number[]).includes(days)) return fail("Pick how long.");
        const now = new Date();
        if (p.status === "sent") {
          const next = extendedExpiry(str(p.expires_at) || null, now, days);
          const { error } = await ctx.sb.from("job_proposals").update({ expires_at: next.toISOString() }).eq("id", id).eq("organization_id", ctx.organizationId).eq("status", "sent");
          return error ? fail(error.message) : done(`Now stands until ${salesDay(next.toISOString())}.`);
        }
        if (p.status === "declined" && p.office_declined_from === "sent" && j.declined_reason === EXPIRED_REASON) {
          return attempt(async () => {
            await reopenOfficeDeclined(ctx.sb as never, jobId);
            const next = extendedExpiry(null, now, days);
            const { error } = await ctx.sb.from("job_proposals").update({ expires_at: next.toISOString() }).eq("id", id).eq("organization_id", ctx.organizationId);
            if (error) return fail(error.message);
            await ctx.sb.from("jobs").update({ declined_at: null, declined_by: null, declined_reason: null }).eq("id", jobId).eq("declined_reason", EXPIRED_REASON);
            return done(`Reopened. It now stands until ${salesDay(next.toISOString())}.`);
          }, "Couldn't reopen it.");
        }
        return fail("Only a proposal that is out, or one that ran out of time, can be extended.");
      }
      case "accept": {
        if (p.status !== "sent") return fail("Only a proposal the client has can be marked accepted.");
        return attempt(async () => {
          await respondToProposal(str(p.token), "accepted", "Marked accepted by the office.");
          return done("Marked accepted. The job is approved.");
        }, "Couldn't mark it accepted.");
      }
      case "decline": {
        const r = await closeJob(jobId, "declined", (value ?? "").trim() || "Declined, marked by the office.");
        return r.ok ? done("Marked declined.") : fail(r.message);
      }
      case "win_back": {
        const names = areasOf(p).map((a) => a.zoneName);
        const { keep, unknown } = readAreaList(value, names);
        if (unknown.length) return fail(`Not on this proposal: ${unknown.join(", ")}.`);
        if (!keep.length) return fail("Name at least one area.");
        const r = await makePhaseOne({ jobId, keep });
        return r.ok ? done(r.message) : fail(r.message);
      }
      case "stop_messages":
        return setDoNotContact(ctx, customerOfJob(j).id, true);
      case "allow_messages":
        return setDoNotContact(ctx, customerOfJob(j).id, false);
    }
    return fail("That can't be done here.");
  },
};

/* ------------------------------------------------------------------ */
/* sales.client                                                         */
/* ------------------------------------------------------------------ */

const client: EntityHandler = {
  kind: "sales.client",
  async load(ctx, id) {
    if (!isId(id)) return null;
    const { data: c } = await ctx.sb
      .from("customers")
      .select("id,name,email,phone,do_not_contact,source,contact_type,account_manager_id,notes,created_at")
      .eq("id", id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!c) return null;
    const [jobs, consent, log, manager, held] = await Promise.all([
      ctx.sb
        .from("jobs")
        .select("id,name,status,evaluation_date,created_at,property:properties!inner(address,customer_id)")
        .eq("property.customer_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
      ctx.sb.from("client_consent").select("channel,state,source,changed_at").eq("customer_id", id).eq("organization_id", ctx.organizationId),
      ctx.sb.from("client_message_log").select("kind,channel,status,skip_reason,created_at").eq("customer_id", id).eq("organization_id", ctx.organizationId).order("created_at", { ascending: false }).limit(15),
      profileName(ctx, c.account_manager_id),
      heldFor(ctx, "customer_id", id),
    ]);
    const consentRows = (consent.data ?? []) as Row[];
    const consentOf = (ch: string) => {
      const r = consentRows.find((x) => x.channel === ch);
      return r ? `${statusWords(str(r.state))} (${str(r.source)}, ${salesDay(str(r.changed_at))})` : "Not asked";
    };
    return {
      title: str(c.name) || "Unnamed client",
      subtitle: [str(c.email), str(c.phone)].filter(Boolean).join(" · ") || undefined,
      status: c.do_not_contact ? "Do not contact" : statusWords(str(c.contact_type)),
      fields: [
        { label: "Email", value: str(c.email) },
        { label: "Phone", value: str(c.phone) },
        { label: "Account manager", value: manager },
        { label: "Source", value: str(c.source) },
        { label: "Texts", value: consentOf("sms") },
        { label: "Email consent", value: consentOf("email") },
        { label: "Do not contact", value: c.do_not_contact ? "Yes: no automated message goes to them" : "No" },
        { label: "Client since", value: salesDay(str(c.created_at)) },
        ...(c.notes ? [{ label: "Notes", value: str(c.notes) }] : []),
      ],
      sections: [
        {
          title: "Jobs",
          rows: ((jobs.data ?? []) as Row[]).map((j) => row(`${place((j.property as Row | null)?.address) || str(j.name)} · ${statusWords(str(j.status))}${j.evaluation_date ? ` · visit ${salesDay(str(j.evaluation_date))}` : ""}`, "sales.job", j.id)),
          empty: "No jobs.",
        },
        { title: "Emails held for you", rows: held, empty: "Nothing held." },
        {
          title: "Messages sent",
          rows: ((log.data ?? []) as Row[]).map((m) => ({
            text: `${salesDay(str(m.created_at))} · ${statusWords(str(m.kind))} · ${m.channel === "sms" ? "text" : "email"} · ${str(m.status)}${m.skip_reason ? ` (${str(m.skip_reason)})` : ""}`,
          })),
          empty: "No automated messages on record.",
        },
      ],
      actions: [
        { id: "email", label: "Change email", input: { type: "email", label: "Email", initial: str(c.email), placeholder: "name@example.com" } },
        { id: "phone", label: "Change phone", input: { type: "tel", label: "Phone", initial: str(c.phone) } },
        c.do_not_contact
          ? { id: "allow_messages", label: "Allow contact again", confirm: "Let messages reach this client again? Anything they said STOP to stays stopped." }
          : { id: "stop_messages", label: "Mark do not contact", tone: "danger", confirm: "Mark this client do-not-contact? No automated text or email will go to them." },
      ],
      note: "Do not contact stops every automated message and campaign. A STOP or unsubscribe they sent is kept separately and isn't undone here.",
    };
  },
  async act(ctx, id, action, value) {
    if (!isId(id)) return fail("That client isn't there any more.");
    const { data: c } = await ctx.sb.from("customers").select("id,email,phone").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!c) return fail("That client isn't there any more.");
    switch (action) {
      case "email": {
        const email = (value ?? "").trim();
        if (email && !EMAIL_RE.test(email)) return fail("That doesn't look like an email address.");
        return attempt(async () => {
          await updateCustomerContact(id, { email: email || null, phone: str(c.phone) || null });
          return done(email ? "Email saved." : "Email cleared.");
        }, "Couldn't save that.");
      }
      case "phone": {
        const phone = (value ?? "").trim();
        if (phone && phone.replace(/\D/g, "").length < 10) return fail("A phone number needs ten digits.");
        return attempt(async () => {
          await updateCustomerContact(id, { email: str(c.email) || null, phone: phone || null });
          return done(phone ? "Phone saved." : "Phone cleared.");
        }, "Couldn't save that.");
      }
      case "stop_messages":
        return setDoNotContact(ctx, id, true);
      case "allow_messages":
        return setDoNotContact(ctx, id, false);
    }
    return fail("That can't be done here.");
  },
};

/* ------------------------------------------------------------------ */
/* sales.evaluator                                                      */
/* ------------------------------------------------------------------ */

const evaluator: EntityHandler = {
  kind: "sales.evaluator",
  async load(ctx, id) {
    if (!isId(id)) return null;
    const { data: p } = await ctx.sb.from("profiles").select("id,full_name,email,phone,does_evaluations,commission_pct").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!p) return null;
    const now = new Date().toISOString();
    const visitCols = "id,name,evaluation_date,evaluation_status,status,property:properties!inner(address,customer:customers!inner(name,organization_id))";
    const [upcoming, past, territories, scorecard] = await Promise.all([
      ctx.sb.from("jobs").select(visitCols).eq("assigned_to", id).eq("property.customer.organization_id", ctx.organizationId).gte("evaluation_date", now).neq("evaluation_status", "cancelled").order("evaluation_date").limit(25),
      ctx.sb.from("jobs").select(visitCols).eq("assigned_to", id).eq("property.customer.organization_id", ctx.organizationId).lt("evaluation_date", now).order("evaluation_date", { ascending: false }).limit(15),
      loadTerritories(ctx.sb, ctx.organizationId),
      loadScorecard(ctx.organizationId).catch(() => null),
    ]);
    const territory = territories.territories.find((t) => t.evaluatorId === id) ?? null;
    const card = scorecard?.rows.find((r) => r.evaluatorId === id) ?? null;
    const pctText = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
    const visitRow = (j: Row) => {
      const prop = (j.property as Row | null) ?? {};
      return row(`${salesWhen(str(j.evaluation_date))} · ${place(prop.address)} · ${statusWords(str(j.evaluation_status))}`, "sales.evaluation", j.id);
    };
    const actions: EntityAction[] = [];
    if (territories.ready) {
      actions.push({ id: "zips", label: "Set territory zip codes", input: { type: "textarea", label: "Zip codes (blank covers everywhere)", initial: (territory?.zips ?? []).join(", "), placeholder: "21014, 21015, 21050" } });
      if (territory) actions.push({ id: "territory_active", label: territory.active ? "Pause territory" : "Turn territory on", confirm: territory.active ? "Pause this territory? They'll be offered bookings anywhere until it is back on." : undefined });
    }
    actions.push(
      p.does_evaluations
        ? { id: "evaluations_off", label: "Stop booking them evaluations", tone: "danger", confirm: "Take them off the evaluation booking? Visits already booked stay theirs." }
        : { id: "evaluations_on", label: "Book them evaluations", confirm: "Let clients be booked with them?" }
    );
    return {
      title: str(p.full_name) || str(p.email),
      subtitle: [str(p.email), str(p.phone)].filter(Boolean).join(" · ") || undefined,
      status: p.does_evaluations ? "Takes evaluations" : "Not taking evaluations",
      fields: [
        { label: "Commission", value: p.commission_pct == null ? "Not set" : `${num(p.commission_pct)}%` },
        { label: "Territory", value: !territories.ready ? "Not set up yet" : !territory || (!territory.zips.length && !territory.areas.length) ? "Everywhere" : `${territory.zips.length ? territory.zips.join(", ") : ""}${territory.areas.length ? `${territory.zips.length ? " + " : ""}${territory.areas.length} drawn area${territory.areas.length === 1 ? "" : "s"}` : ""}${territory.active ? "" : " (paused)"}` },
        ...(card
          ? [
              { label: `Close rate (${scorecard!.windowDays} days)`, value: `${pctText(card.closeRate)} (${card.accepted} of ${card.accepted + card.declined})` },
              { label: "Visits", value: `${card.visits} · ${pctText(card.showRate)} happened` },
              { label: "Proposals sent", value: String(card.proposalsSent) },
              { label: "Speed to proposal", value: card.medianHoursToProposal == null ? "—" : `${card.medianHoursToProposal.toFixed(1)} h median` },
              { label: "Average ticket", value: dollars(card.averageTicket) },
              { label: "Revenue sold", value: dollars(card.revenueSold) },
              { label: "Commission earned", value: dollars(card.commissionEarned) },
            ]
          : [{ label: "Scorecard", value: "No evaluations in the window." }]),
      ],
      sections: [
        { title: "Upcoming visits", rows: ((upcoming.data ?? []) as Row[]).map(visitRow), empty: "Nothing booked." },
        { title: "Recent visits", rows: ((past.data ?? []) as Row[]).map(visitRow), empty: "None yet." },
      ],
      actions,
      note: "Territory zip codes are optional: a booking goes to the free evaluator whose territory it is, otherwise to anybody free. Drawn areas are kept when the zips change; draw them in the Territories panel.",
    };
  },
  async act(ctx, id, action, value) {
    if (!isId(id)) return fail("That person isn't on the team.");
    const { data: p } = await ctx.sb.from("profiles").select("id").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!p) return fail("That person isn't on the team.");
    if (action === "zips" || action === "territory_active") {
      const { territories } = await loadTerritories(ctx.sb, ctx.organizationId);
      const t = territories.find((x) => x.evaluatorId === id) ?? null;
      const r = await saveTerritory({
        evaluatorId: id,
        zips: action === "zips" ? value ?? "" : (t?.zips ?? []).join(" "),
        areas: t?.areas ?? [],
        active: action === "territory_active" ? !(t?.active ?? true) : t?.active ?? true,
      });
      return r.ok ? done(r.message) : fail(r.error);
    }
    if (action === "evaluations_on" || action === "evaluations_off") {
      const r = await setDoesEvaluations({ profileId: id, value: action === "evaluations_on" });
      return r.ok ? done(action === "evaluations_on" ? "They can be booked for evaluations." : "Off the evaluation booking.") : fail(r.error);
    }
    return fail("That can't be done here.");
  },
};

/* ------------------------------------------------------------------ */
/* sales.invoice                                                        */
/* ------------------------------------------------------------------ */

const COLLECT_OPTIONS: { value: CollectMethod; label: string }[] = (["check", "cash", "zelle", "transfer"] as CollectMethod[]).map((m) => ({ value: m, label: offlineMethodLabel(m)[0].toUpperCase() + offlineMethodLabel(m).slice(1) }));

const invoice: EntityHandler = {
  kind: "sales.invoice",
  async load(ctx, id) {
    if (!isId(id)) return null;
    const { data: i } = await ctx.sb.from("invoices").select("id,job_id,amount,status,sent_at,paid_at,pay_by,created_at,collected_note").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!i) return null;
    const j = await ownJob(ctx, str(i.job_id));
    const c = j ? customerOfJob(j) : {};
    const open = i.status === "open" || i.status === "draft";
    return {
      title: `Invoice · ${dollars(num(i.amount))}`,
      subtitle: j ? `${str(c.name) || "Unnamed client"} · ${place(addressOfJob(j))}` : undefined,
      status: statusWords(str(i.status)),
      fields: [
        { label: "Amount", value: dollars(num(i.amount)) },
        { label: "Raised", value: salesDay(str(i.created_at)) },
        { label: "Sent", value: salesDay(str(i.sent_at) || null) },
        { label: "Paid", value: i.paid_at ? `${salesDay(str(i.paid_at))}${i.pay_by ? ` by ${str(i.pay_by)}` : ""}` : "Not yet" },
        ...(i.collected_note ? [{ label: "Note", value: str(i.collected_note) }] : []),
      ],
      sections: j
        ? [
            { title: "Job", rows: [row(`${str(j.name) || place(addressOfJob(j))} · ${statusWords(str(j.status))}`, "sales.job", j.id)] },
            { title: "Client", rows: [row(str(c.name) || "Unnamed client", "sales.client", c.id)] },
          ]
        : [],
      actions: open
        ? [
            {
              id: "collected",
              label: `Record ${dollars(num(i.amount))} collected`,
              tone: "primary",
              confirm: "Record the full amount as paid outside the card form? The invoice is marked paid and Stripe is told.",
              input: { type: "select", label: "Paid by", options: COLLECT_OPTIONS, initial: "check", required: true },
            },
            { id: "reissue", label: "Reissue at the proposal's price", confirm: "Void this invoice and send a fresh one at the proposal's current total?" },
          ]
        : [],
      note: open ? undefined : "Nothing to do: this invoice is settled.",
    };
  },
  async act(ctx, id, action, value) {
    if (!isId(id)) return fail("That invoice isn't on file.");
    const { data: i } = await ctx.sb.from("invoices").select("id,job_id,amount").eq("id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!i) return fail("That invoice isn't on file.");
    if (action === "collected") {
      if (!isCollectMethod(value)) return fail("Pick how they paid.");
      const r = await markPaymentCollected({ invoiceId: id, method: value, amountCents: Math.round(num(i.amount) * 100) });
      return r.ok ? done(r.message) : fail(r.message);
    }
    if (action === "reissue") {
      const r = await reissueInvoiceForJob(str(i.job_id));
      return r.ok ? done(r.message) : fail(r.message);
    }
    return fail("That can't be done here.");
  },
};

/* ------------------------------------------------------------------ */
/* sales.approval: an automatic email held for the owner              */
/* ------------------------------------------------------------------ */

const approval: EntityHandler = {
  kind: "sales.approval",
  async load(ctx, id) {
    if (!isId(id)) return null;
    const { data: a } = await ctx.sb
      .from("outbound_approvals")
      .select("id,kind,source,to_email,to_name,subject,body,status,payload,created_at,expires_at,decided_at,detail,job_id,customer_id")
      .eq("id", id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!a) return null;
    const held = ((a.payload ?? {}) as { held_because?: string }).held_because;
    const pending = a.status === "pending";
    const sections: EntityView["sections"] = [];
    if (isId(a.job_id)) sections.push({ title: "Job", rows: [row("Open the job", "sales.job", a.job_id)] });
    if (isId(a.customer_id)) sections.push({ title: "Client", rows: [row(str(a.to_name) || str(a.to_email), "sales.client", a.customer_id)] });
    return {
      title: str(a.subject) || "Held email",
      subtitle: `To ${str(a.to_name) ? `${str(a.to_name)} <${str(a.to_email)}>` : str(a.to_email)}`,
      status: statusWords(str(a.status)),
      fields: [
        { label: "Kind", value: statusWords(str(a.kind)) },
        { label: "Held because", value: held ? HOLD_REASON_LABEL[held as keyof typeof HOLD_REASON_LABEL] ?? statusWords(held) : "Every email waits for you" },
        { label: "Written", value: salesWhen(str(a.created_at)) },
        { label: "Closes", value: a.expires_at ? salesWhen(str(a.expires_at)) : "Doesn't" },
        ...(a.decided_at ? [{ label: "Decided", value: `${salesWhen(str(a.decided_at))}${a.detail ? ` · ${str(a.detail)}` : ""}` }] : []),
        { label: "Words", value: str(a.body).slice(0, 1200) },
      ],
      sections,
      actions: pending
        ? [
            { id: "send", label: "Send it", tone: "primary", confirm: `Send this email to ${str(a.to_email)} now?` },
            {
              id: "decline",
              label: "Don't send",
              tone: "danger",
              confirm: "Close this email unsent?",
              input: { type: "select", label: "Why not", options: DECLINE_REASONS.map((r) => ({ value: r, label: DECLINE_REASON_LABEL[r] })), initial: "other", required: true },
            },
          ]
        : [],
      note: pending ? "The reason you give is counted, so the trigger behind repeat declines can be fixed." : "Already dealt with.",
    };
  },
  async act(ctx, id, action, value) {
    if (!isId(id)) return fail("That one has already been dealt with.");
    const { data: a } = await ctx.sb.from("outbound_approvals").select("id").eq("id", id).eq("organization_id", ctx.organizationId).eq("status", "pending").maybeSingle();
    if (!a) return fail("That one has already been dealt with.");
    if (action === "send") {
      const r = await approveOutbound(id);
      return r.ok ? done(r.message) : fail(r.message);
    }
    if (action === "decline") {
      const reason = value && isDeclineReason(value) ? value : undefined;
      const r = await declineOutbound(id, reason);
      return r.ok ? done(r.message) : fail(r.message);
    }
    return fail("That can't be done here.");
  },
};

/* ------------------------------------------------------------------ */
/* sales.service: a pricing formula                                     */
/* ------------------------------------------------------------------ */

const service: EntityHandler = {
  kind: "sales.service",
  async load(ctx, id) {
    if (!isId(id)) return null;
    const { data: s } = await ctx.sb
      .from("services")
      .select("service_type_id,name,status,cost,cost_unit,pricing_basis,cogs,estimated_hours,crew_size,performed_by,updated_at")
      .eq("service_type_id", id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    if (!s) return null;
    return {
      title: str(s.name),
      status: statusWords(str(s.status)),
      fields: [
        { label: "Rate", value: s.cost == null ? "No rate: every price with this service is held" : `$${num(s.cost)} ${str(s.cost_unit)}` },
        { label: "Priced by", value: statusWords(str(s.pricing_basis)) },
        { label: "Cost of goods", value: s.cogs == null ? "—" : `$${num(s.cogs)}` },
        { label: "Estimated hours", value: s.estimated_hours == null ? "—" : String(s.estimated_hours) },
        { label: "Crew size", value: String(s.crew_size ?? "—") },
        { label: "Done by", value: statusWords(str(s.performed_by)) },
        { label: "Updated", value: salesDay(str(s.updated_at)) },
      ],
      actions: [{ id: "rate", label: "Set the rate", tone: "primary", input: { type: "text", label: `Rate in dollars (${str(s.cost_unit) || "flat rate"}); blank clears it`, initial: s.cost == null ? "" : String(s.cost) } }],
      note: "Proposals are priced automatically from this rate. A service without one holds every price it is on.",
    };
  },
  async act(ctx, id, action, value) {
    if (action !== "rate") return fail("That can't be done here.");
    if (!isId(id)) return fail("That service no longer exists.");
    const { data: s } = await ctx.sb.from("services").select("cost_unit").eq("service_type_id", id).eq("organization_id", ctx.organizationId).maybeSingle();
    if (!s) return fail("That service no longer exists.");
    const r = await setServiceRate(id, value ?? "", str(s.cost_unit));
    return r.ok ? done(r.message) : fail(r.error);
  },
};

/* ------------------------------------------------------------------ */
/* sales.photo_quote: a small job sent in with photos, keyed by its job */
/* ------------------------------------------------------------------ */

const photoQuote: EntityHandler = {
  kind: "sales.photo_quote",
  async load(ctx, id) {
    const j = await ownJob(ctx, id);
    if (!j) return null;
    const c = customerOfJob(j);
    const { data } = await ctx.sb
      .from("evaluation_intakes")
      .select("answers,submitted_at,photo_quote,photo_quote_outcome,photo_quote_outcome_at")
      .eq("job_id", id)
      .eq("organization_id", ctx.organizationId)
      .maybeSingle();
    const intake = data as Row | null;
    if (!intake?.photo_quote) return null;
    const answers = cleanAnswers(intake.answers);
    const outcome = str(intake.photo_quote_outcome);
    const status = j.evaluation_date ? "Visit booked" : outcome === "visit" ? "Asked for a visit" : outcome === "priced" ? "Priced" : intake.submitted_at ? "Waiting for a price" : "Not sent in yet";
    const photosOf = (spotId: string) => answers.photos.filter((p) => answers.photo_areas[p] === spotId).length;
    const actions: EntityAction[] = [];
    if (!j.evaluation_date && j.status !== "cancelled") {
      actions.push({ id: "visit", label: "Needs a visit", tone: "primary", confirm: "Send them a link to pick a time for a visit?" });
      if (outcome !== "priced") actions.push({ id: "priced", label: "Mark priced" });
    }
    return {
      title: `Photo quote · ${place(addressOfJob(j))}`,
      subtitle: str(c.name) || undefined,
      status,
      fields: [
        { label: "Client", value: str(c.name) || "Unnamed client" },
        { label: "Phone", value: str(c.phone) },
        { label: "Email", value: str(c.email) },
        { label: "Address", value: addressOfJob(j) },
        { label: "Budget", value: str(j.budget_range) || "Not given" },
        { label: "Sent in", value: intake.submitted_at ? salesWhen(str(intake.submitted_at)) : "Not yet" },
        ...(j.evaluation_date ? [{ label: "Visit", value: salesWhen(str(j.evaluation_date)) }] : []),
      ],
      sections: [
        {
          title: "Areas",
          rows: answers.spots.map((s, i) => ({
            text: `Area ${i + 1}: ${s.wants || "nothing written"}${s.services.length ? ` (${s.services.map(statusWords).join(", ")})` : ""} · ${s.noPhotos ? "no photos, use the satellite" : `${photosOf(s.id)} photo${photosOf(s.id) === 1 ? "" : "s"}`}`.slice(0, 240),
          })),
          empty: "No areas marked yet.",
        },
        {
          title: "Ideas they'd be interested in",
          rows: answers.spots.flatMap((s, i) => s.ideas.filter((x) => x.interested).map((x) => ({ text: `Area ${i + 1}: ${x.text}` }))),
          empty: "None ticked.",
        },
        { title: "Job", rows: [row(`${str(j.name) || place(addressOfJob(j))} · ${statusWords(str(j.status))}`, "sales.job", j.id)] },
        { title: "Client", rows: [row(str(c.name) || "Unnamed client", "sales.client", c.id)] },
      ],
      actions,
      note: "Price it on the job's site map and proposal, the way every job is priced: the photos are on the job. Needs a visit texts or emails them a link to pick a time, and the visit lands on this job.",
    };
  },
  async act(ctx, id, action) {
    const j = await ownJob(ctx, id);
    if (!j) return fail("That job isn't there any more.");
    if (action === "visit") {
      const r = await askForVisit(id);
      return r.ok ? done(r.message) : fail(r.error);
    }
    if (action === "priced") {
      const r = await markPhotoQuotePriced(id);
      return r.ok ? done(r.message) : fail(r.error);
    }
    return fail("That can't be done here.");
  },
};

/** What can be opened and done from the Sales page's lists. */
export const SALES_HANDLERS: EntityHandler[] = [job, evaluation, proposal, client, evaluator, invoice, approval, service, photoQuote];


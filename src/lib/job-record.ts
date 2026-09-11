import { PROPOSAL_TERMS, type ProposalTerm } from "@/lib/proposal-terms";
import { expectationsFor, type Expectation } from "@/lib/expectations";
import { groupByService } from "@/lib/service-grouping";

/**
 * The job record: everything that was said, agreed, changed and paid on one
 * job, in one document.
 *
 * Built for the day something goes wrong. A client rings upset, or a callback
 * is booked, and the account manager has to stand on the property and say
 * with certainty what was promised, what was not, what got added afterwards
 * and what has been paid. Until now that meant opening five tabs on a phone
 * in a driveway and hoping nothing was missed. This puts all of it on paper,
 * in the order the conversation goes.
 *
 * Two copies come out of the same record. The full copy carries the team's
 * internal notes and the evaluator's pinned remarks, which is what the
 * account manager reads on the way over. The client copy leaves those out,
 * because a note that says "she was difficult about the price" is a note
 * that should never be handed across a kitchen table.
 *
 * Pure. Everything here is derived from what was loaded; nothing reads or
 * writes. The loader in `data/job-record.ts` does the gathering, and this
 * decides what it means.
 */

export interface RecordParty {
  name: string;
  phone: string | null;
  email: string | null;
}

export interface RecordBusiness {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
}

export interface RecordJob {
  number: string | null;
  name: string;
  status: string;
  evaluationDate: string | null;
  evaluationStatus: string;
  projectStart: string | null;
  projectEnd: string | null;
  completedAt: string | null;
  completedByName: string | null;
  completionNotes: string | null;
  /** What the client wrote when they booked. */
  clientNotes: string | null;
  budgetRange: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  declinedAt: string | null;
  declinedReason: string | null;
  disputeOpenedAt: string | null;
  disputeKind: string | null;
  disputeReason: string | null;
}

export interface RecordZone {
  name: string;
  service: string;
  scopeText: string;
  priceCents: number | null;
  /** "own" or "partner"; a partner's name when one was named. */
  performedBy: "own" | "partner";
  partnerName: string | null;
}

export interface RecordProposal {
  status: string;
  totalCost: number | null;
  discountAmount: number;
  discountReason: string | null;
  generatedAt: string;
  approvedAt: string | null;
  respondedAt: string | null;
  responseNote: string | null;
  paymentPath: string | null;
  clientChosenDay: string | null;
  paidAt: string | null;
  zones: RecordZone[];
  recommendedScope: string | null;
}

/** Something the office took off the proposal after it went out. */
export interface RecordTrim {
  at: string;
  byName: string | null;
  removedZones: { zoneName: string; serviceLabel: string; priceCents: number | null }[];
  removedLines: { zoneName: string; line: string }[];
  previousTotalCents: number | null;
  newTotalCents: number | null;
  note: string | null;
  requestedVia: string | null;
}

/** Areas the client themselves asked to keep or drop from the proposal page. */
export interface RecordScopeRequest {
  at: string;
  kept: string[];
  dropped: string[];
  status: string;
  previousTotalCents: number | null;
  newTotalCents: number | null;
}

/** Work asked for after the sale, whatever became of it. */
export interface RecordChange {
  requestedAt: string;
  requestedByName: string | null;
  requestedNote: string;
  status: string;
  statusLabel: string;
  priceCents: number | null;
  terms: string | null;
  reviewNote: string | null;
  clientDecision: "approved" | "declined" | null;
  clientDecisionAt: string | null;
  clientDecisionNote: string | null;
  clientDecisionChannel: string | null;
  executableAt: string | null;
}

export type RecordVoice = "client" | "team" | "system";

export interface RecordMessage {
  at: string;
  from: RecordVoice;
  name: string;
  /** Where it was said: proposal page, text, email, phone, team note. */
  channel: string;
  body: string;
  /** What they were looking at when they wrote, when the app knows. */
  reference: string | null;
  /** Team-only. Never on the client copy. */
  internal: boolean;
}

export interface RecordObjection {
  at: string;
  question: string;
  note: string | null;
  resolution: string | null;
  resolved: boolean | null;
}

export interface RecordEvalEdit {
  at: string;
  byName: string | null;
  changes: string[];
  requestedVia: string | null;
  note: string | null;
}

export interface RecordVisit {
  startsOn: string;
  endsOn: string;
  status: string;
  purpose: string | null;
  pauseReason: string | null;
}

export interface RecordTicket {
  at: string;
  title: string;
  detail: string | null;
  cause: string | null;
  severity: string;
  status: string;
  billable: boolean;
  resolution: string | null;
  resolvedAt: string | null;
}

export interface RecordWalkthrough {
  requestedAt: string;
  requestedNote: string | null;
  status: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
}

export interface RecordIssue {
  at: string;
  type: string;
  severity: string;
  title: string;
  description: string | null;
  status: string;
  resolution: string | null;
  resolvedAt: string | null;
  ownerName: string | null;
}

export interface RecordException {
  at: string;
  kind: string;
  summary: string;
  detail: string | null;
  state: string;
  resolution: string | null;
  resolvedAt: string | null;
  reportedByName: string | null;
}

export interface RecordPayment {
  at: string;
  /** What the job was paid, with any card fee taken off. */
  amountCents: number;
  method: string;
  receiptNumber: string | null;
  reference: string | null;
}

export interface RecordInvoice {
  amountCents: number;
  status: string;
  sentAt: string | null;
  paidAt: string | null;
}

export interface RecordPhoto {
  at: string;
  phase: string;
  zoneName: string | null;
  caption: string | null;
  url: string | null;
}

export interface RecordMark {
  note: string;
  authorName: string | null;
  createdAt: string;
}

export interface RecordReading {
  opens: number;
  firstAt: string | null;
  lastAt: string | null;
  totalSeconds: number;
  /** The section they spent longest on, in words. */
  focus: string | null;
}

/** The picture of the property with the areas drawn on it, as the client saw it. */
export interface RecordSiteMap {
  imagePath: string;
  transform: { x: number; y: number; scale: number; rotation: number; canvasWidth: number; canvasHeight: number };
  zones: { zoneName: string; color: string; points: { x: number; y: number }[] }[];
}

export interface JobRecordInput {
  generatedAt: string;
  siteMap: RecordSiteMap | null;
  business: RecordBusiness;
  job: RecordJob;
  customer: RecordParty;
  address: string;
  accountManager: { name: string; phone: string | null } | null;
  /** What they ticked when they booked, in words. */
  requestedServices: string[];
  proposal: RecordProposal | null;
  trims: RecordTrim[];
  scopeRequests: RecordScopeRequest[];
  changes: RecordChange[];
  messages: RecordMessage[];
  objections: RecordObjection[];
  evalEdits: RecordEvalEdit[];
  visits: RecordVisit[];
  tickets: RecordTicket[];
  walkthroughs: RecordWalkthrough[];
  issues: RecordIssue[];
  exceptions: RecordException[];
  payments: RecordPayment[];
  invoices: RecordInvoice[];
  photos: RecordPhoto[];
  marks: RecordMark[];
  reading: RecordReading | null;
}

export interface RecordFact {
  label: string;
  value: string;
}

export interface RecordGroup {
  service: string;
  zones: RecordZone[];
}

export interface RecordAgreed {
  groups: RecordGroup[];
  totalCents: number | null;
  discountCents: number;
  discountReason: string | null;
  status: string;
  /** "Accepted 3 Sep 2026 at 2:10 pm", or what happened instead. */
  outcome: string;
  responseNote: string | null;
  paymentPath: string | null;
  clientChosenDay: string | null;
  terms: ProposalTerm[];
  expectations: Expectation[];
}

export interface RecordNotIncluded {
  /** Areas and lines taken off after the proposal went out, dated. */
  removed: string[];
  /** Asked for at booking, never on the proposal. */
  askedNotQuoted: string[];
  /** Asked for after the sale and turned down, by either side. */
  declined: RecordChange[];
  /** The standing rule, so the page says it even when nothing was removed. */
  rule: string[];
}

export interface RecordMoney {
  quotedCents: number | null;
  discountCents: number;
  addedCents: number;
  /** Quoted, less discount, plus approved additions. */
  dueCents: number | null;
  paidCents: number;
  outstandingCents: number | null;
  invoices: RecordInvoice[];
  payments: RecordPayment[];
}

export interface TimelineEntry {
  at: string;
  what: string;
  detail: string | null;
  /** Team-only lines drop off the client copy. */
  internal: boolean;
}

export interface JobRecord {
  clientCopy: boolean;
  generatedAt: string;
  siteMap: RecordSiteMap | null;
  business: RecordBusiness;
  job: RecordJob;
  customer: RecordParty;
  address: string;
  accountManager: { name: string; phone: string | null } | null;
  title: string;
  facts: RecordFact[];
  agreed: RecordAgreed | null;
  notIncluded: RecordNotIncluded;
  addedLater: RecordChange[];
  pendingChanges: RecordChange[];
  /** Everything said to or by the client, oldest first. */
  communications: RecordMessage[];
  /** The team's own notes. Empty on the client copy. */
  internalNotes: RecordMessage[];
  objections: RecordObjection[];
  evalEdits: RecordEvalEdit[];
  scopeRequests: RecordScopeRequest[];
  visits: RecordVisit[];
  tickets: RecordTicket[];
  walkthroughs: RecordWalkthrough[];
  issues: RecordIssue[];
  exceptions: RecordException[];
  money: RecordMoney;
  photos: RecordPhoto[];
  /** The evaluator's pinned remarks on the map. Empty on the client copy. */
  marks: RecordMark[];
  reading: RecordReading | null;
  timeline: TimelineEntry[];
  /** What to have in mind before walking the property. */
  walkNotes: string[];
}

/** Anything not written on the proposal was not part of the job. Stated on
 * every record, because it is the sentence the whole conversation turns on. */
export const NOT_INCLUDED_RULE: string[] = [
  "Only the work written on the accepted proposal was part of this job. Anything not listed there was not quoted and was not included.",
  "Our crew cannot add or approve work on site. Anything asked for after acceptance is written up, priced and booked as its own visit, and appears below under work added afterwards.",
];

export const RECORD_TITLE = "Job record";

/**
 * How the proposal ended, as a sentence.
 *
 * "Accepted" is the answer that matters, so it carries the date. A proposal
 * with no answer is said plainly rather than shown as a blank.
 */
export function proposalOutcome(proposal: Pick<RecordProposal, "status" | "respondedAt" | "approvedAt">): string {
  if (proposal.status === "accepted") {
    return proposal.respondedAt ? `Accepted ${longWhen(proposal.respondedAt)}` : "Accepted";
  }
  if (proposal.status === "declined") {
    return proposal.respondedAt ? `Declined ${longWhen(proposal.respondedAt)}` : "Declined";
  }
  if (proposal.status === "sent") return "Sent, not yet answered";
  if (proposal.status === "needs_approval") return "Drafted, not yet sent";
  return proposal.status.replace(/_/g, " ");
}

export function paymentPathLabel(path: string | null): string | null {
  if (!path) return null;
  if (path === "full") return "Paying in full";
  if (path === "plan") return "Payment plan";
  if (path === "plan_no_discount") return "Payment plan, no discount";
  return path.replace(/_/g, " ");
}

/**
 * Lines for what came off the proposal, each with its date.
 *
 * A removed area is named with its service and, where it was priced, what it
 * was worth, because "we took the side bed off and the price dropped $400"
 * is a sentence that ends an argument.
 */
export function removedLines(trims: RecordTrim[], requests: RecordScopeRequest[]): string[] {
  const lines: string[] = [];
  for (const trim of trims) {
    const when = shortDay(trim.at);
    const via = trim.requestedVia ? ` (asked by ${viaLabel(trim.requestedVia)})` : "";
    for (const zone of trim.removedZones) {
      const price = zone.priceCents != null ? `, ${money(zone.priceCents)}` : "";
      lines.push(`${when}: ${zone.zoneName} (${zone.serviceLabel}${price}) taken off${via}.`);
    }
    for (const line of trim.removedLines) {
      lines.push(`${when}: "${line.line}" taken out of ${line.zoneName}${via}.`);
    }
    if (trim.removedZones.length === 0 && trim.removedLines.length === 0 && trim.note) {
      lines.push(`${when}: ${trim.note}`);
    }
  }
  for (const request of requests) {
    if (request.dropped.length === 0) continue;
    const who = request.status === "applied" || request.status === "accepted" ? "dropped" : `asked to drop (${request.status.replace(/_/g, " ")})`;
    lines.push(`${shortDay(request.at)}: client ${who} ${request.dropped.join(", ")} from the proposal page.`);
  }
  return lines;
}

/**
 * Services ticked at booking that never made the proposal.
 *
 * Matched on words rather than ids: the proposal snapshot holds labels, and a
 * "Mulching" request against a "Mulch bed" zone is the same thing.
 */
export function askedNotQuoted(requested: string[], zones: RecordZone[]): string[] {
  const quoted = zones.map((zone) => `${zone.service} ${zone.scopeText}`.toLowerCase()).join(" \n ");
  return requested.filter((label) => {
    const stem = label.toLowerCase().replace(/(ing|s|ed)$/, "");
    const words = stem.split(/[^a-z]+/).filter((word) => word.length > 3);
    if (words.length === 0) return !quoted.includes(label.toLowerCase());
    return !words.some((word) => quoted.includes(word));
  });
}

function isApproved(change: RecordChange): boolean {
  return change.clientDecision === "approved" || change.status === "client_approved" || change.executableAt != null;
}

function isDeclined(change: RecordChange): boolean {
  return (
    change.clientDecision === "declined" ||
    change.status === "client_declined" ||
    change.status === "rejected" ||
    change.status === "withdrawn"
  );
}

export function moneyOf(input: Pick<JobRecordInput, "proposal" | "changes" | "payments" | "invoices">): RecordMoney {
  const quotedCents = input.proposal?.totalCost != null ? Math.round(input.proposal.totalCost * 100) : null;
  const discountCents = Math.round((input.proposal?.discountAmount ?? 0) * 100);
  const addedCents = input.changes.filter(isApproved).reduce((sum, change) => sum + (change.priceCents ?? 0), 0);
  const paidCents = input.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  // The quoted total already has the discount taken off it; the discount is
  // printed beside it, not subtracted twice.
  const dueCents = quotedCents != null ? quotedCents + addedCents : null;
  return {
    quotedCents,
    discountCents,
    addedCents,
    dueCents,
    paidCents,
    outstandingCents: dueCents != null ? Math.max(0, dueCents - paidCents) : null,
    invoices: input.invoices,
    payments: [...input.payments].sort((a, b) => a.at.localeCompare(b.at)),
  };
}

/**
 * The whole job as one dated list.
 *
 * This is the page the account manager actually reads standing on the
 * driveway: what happened, in order, with nothing left out. Every other
 * section is the same facts grouped by kind.
 */
export function timelineOf(input: JobRecordInput): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const add = (at: string | null | undefined, what: string, detail: string | null = null, internal = false) => {
    if (!at) return;
    entries.push({ at, what, detail, internal });
  };

  const job = input.job;
  add(job.evaluationDate, "Evaluation visit", job.evaluationStatus === "cancelled" ? "Cancelled" : null);
  if (input.proposal) {
    add(input.proposal.generatedAt, "Proposal written", input.proposal.totalCost != null ? money(Math.round(input.proposal.totalCost * 100)) : null);
    add(input.proposal.approvedAt, "Proposal sent to the client");
    if (input.proposal.status === "accepted" || input.proposal.status === "declined") {
      add(
        input.proposal.respondedAt,
        input.proposal.status === "accepted" ? "Client accepted the proposal" : "Client declined the proposal",
        input.proposal.responseNote
      );
    }
    add(input.proposal.clientChosenDay ? `${input.proposal.clientChosenDay}T12:00:00` : null, "Client chose their work day");
    add(input.proposal.paidAt, "Paid through the proposal");
  }
  if (input.reading?.firstAt) add(input.reading.firstAt, "Client first opened the proposal");
  for (const trim of input.trims) {
    add(trim.at, "Proposal trimmed", [...trim.removedZones.map((z) => z.zoneName), ...trim.removedLines.map((l) => `"${l.line}"`)].join(", ") || trim.note);
  }
  for (const request of input.scopeRequests) {
    add(request.at, "Client asked to change the areas", request.dropped.length > 0 ? `Dropped ${request.dropped.join(", ")}` : null);
  }
  for (const edit of input.evalEdits) add(edit.at, "Evaluation updated", edit.changes.join("; ") || edit.note);
  for (const objection of input.objections) {
    add(
      objection.at,
      `Client asked: ${objection.question}`,
      objection.note ?? (objection.resolution ? `We offered: ${objection.resolution.replace(/_/g, " ")}` : null)
    );
  }
  for (const message of input.messages) {
    add(
      message.at,
      message.internal
        ? `Team note by ${message.name}`
        : message.from === "client"
          ? `${message.name} wrote`
          : message.from === "system"
            ? `Sent automatically: ${message.channel}`
            : `${message.name} replied`,
      message.body,
      message.internal
    );
  }
  for (const change of input.changes) {
    add(change.requestedAt, "Extra work requested", change.requestedNote);
    add(change.clientDecisionAt, change.clientDecision === "approved" ? "Client approved the extra work" : "Client declined the extra work", change.clientDecisionNote);
  }
  for (const visit of input.visits) add(`${visit.startsOn}T08:00:00`, "Crew visit", visit.purpose ?? (visit.status === "paused" ? `Paused: ${visit.pauseReason ?? ""}` : visit.status));
  for (const exception of input.exceptions) add(exception.at, `From the field: ${exception.kind}`, exception.summary, true);
  for (const issue of input.issues) add(issue.at, `Issue raised: ${issue.title}`, issue.description, true);
  for (const ticket of input.tickets) {
    add(ticket.at, `Callback: ${ticket.title}`, ticket.detail);
    add(ticket.resolvedAt, `Callback resolved: ${ticket.title}`, ticket.resolution);
  }
  for (const walk of input.walkthroughs) {
    add(walk.requestedAt, "Final walkthrough requested", walk.requestedNote);
    add(walk.reviewedAt, walk.status === "approved" ? "Walkthrough approved" : `Walkthrough ${walk.status}`, walk.reviewNotes);
  }
  add(job.completedAt, "Job marked complete", job.completionNotes);
  for (const invoice of input.invoices) add(invoice.sentAt, "Invoice sent", money(invoice.amountCents));
  for (const payment of input.payments) add(payment.at, "Payment received", `${money(payment.amountCents)} by ${payment.method}`);
  add(job.cancelledAt, "Job cancelled", job.cancellationReason);
  add(job.declinedAt, "Marked declined", job.declinedReason);
  add(job.disputeOpenedAt, "Dispute opened", job.disputeReason);

  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The handful of things to have straight before knocking on the door.
 *
 * Not a summary of the record; the record is the summary. These are the
 * points a conversation with an unhappy client tends to turn on, pulled out
 * so they are not found on page six.
 */
export function walkNotesFor(input: JobRecordInput, money: RecordMoney, agreed: RecordAgreed | null, notIncluded: RecordNotIncluded): string[] {
  const notes: string[] = [];
  if (!input.proposal) {
    notes.push("No proposal was ever written for this job, so there is no agreed scope to hold either side to.");
  } else if (input.proposal.status !== "accepted") {
    notes.push(`The proposal was never accepted (${proposalOutcome(input.proposal).toLowerCase()}), so no work on it was agreed.`);
  } else if (agreed) {
    notes.push(`${agreed.outcome}. ${agreed.groups.length} kind${agreed.groups.length === 1 ? "" : "s"} of work across ${countZones(agreed)} area${countZones(agreed) === 1 ? "" : "s"}.`);
    if (agreed.responseNote) notes.push(`When they accepted they wrote: "${agreed.responseNote}"`);
  }
  if (notIncluded.removed.length > 0) notes.push(`${notIncluded.removed.length} thing${notIncluded.removed.length === 1 ? " was" : "s were"} taken off the proposal before or after it went out. They are listed under not included.`);
  if (notIncluded.askedNotQuoted.length > 0) notes.push(`Asked for at booking but never quoted: ${notIncluded.askedNotQuoted.join(", ")}.`);
  const added = input.changes.filter(isApproved);
  if (added.length > 0) notes.push(`${added.length} piece${added.length === 1 ? "" : "s"} of extra work ${added.length === 1 ? "was" : "were"} approved after the sale, worth ${money_(added.reduce((s, c) => s + (c.priceCents ?? 0), 0))}.`);
  const pending = input.changes.filter((c) => !isApproved(c) && !isDeclined(c));
  if (pending.length > 0) notes.push(`${pending.length} change request${pending.length === 1 ? " is" : "s are"} still open and not yet agreed.`);
  const openTickets = input.tickets.filter((t) => t.status !== "resolved" && t.status !== "closed");
  if (openTickets.length > 0) notes.push(`Open callback${openTickets.length === 1 ? "" : "s"}: ${openTickets.map((t) => t.title).join("; ")}.`);
  const openIssues = input.issues.filter((i) => i.status !== "resolved" && i.status !== "closed");
  if (openIssues.length > 0) notes.push(`Open issue${openIssues.length === 1 ? "" : "s"}: ${openIssues.map((i) => i.title).join("; ")}.`);
  const rejected = input.walkthroughs.filter((w) => w.status === "rejected");
  if (rejected.length > 0 && rejected[0].reviewNotes) notes.push(`The last walkthrough was sent back with: "${rejected[0].reviewNotes}"`);
  if (money.outstandingCents != null && money.outstandingCents > 0) {
    notes.push(`Balance outstanding: ${money_(money.outstandingCents)} of ${money_(money.dueCents ?? 0)}.`);
  } else if (money.dueCents != null && money.paidCents >= money.dueCents && money.dueCents > 0) {
    notes.push(`Paid in full: ${money_(money.paidCents)}.`);
  }
  if (input.job.disputeOpenedAt) notes.push(`A dispute is on file (${input.job.disputeKind ?? "unspecified"}): ${input.job.disputeReason ?? "no reason recorded"}.`);
  if (agreed && agreed.expectations.length > 0) {
    notes.push(`Settling-in expectations that were on their proposal: ${agreed.expectations.map((e) => e.heading).join("; ")}.`);
  }
  if (input.reading && input.reading.opens > 0) {
    notes.push(
      `They opened the proposal ${input.reading.opens} time${input.reading.opens === 1 ? "" : "s"}` +
        (input.reading.totalSeconds > 0 ? ` and read it for about ${describeSeconds(input.reading.totalSeconds)}` : "") +
        (input.reading.focus ? `, longest on ${input.reading.focus}` : "") +
        "."
    );
  }
  return notes;
}

function countZones(agreed: RecordAgreed): number {
  return agreed.groups.reduce((sum, group) => sum + group.zones.length, 0);
}

export function buildJobRecord(input: JobRecordInput, options: { clientCopy?: boolean } = {}): JobRecord {
  const clientCopy = options.clientCopy ?? false;

  const agreed: RecordAgreed | null = input.proposal
    ? {
        groups: groupByService(
          input.proposal.zones.map((zone) => ({ ...zone, serviceLabel: zone.service }))
        ).map((group) => ({ service: group.service, zones: group.zones })),
        totalCents: input.proposal.totalCost != null ? Math.round(input.proposal.totalCost * 100) : null,
        discountCents: Math.round(input.proposal.discountAmount * 100),
        discountReason: input.proposal.discountReason,
        status: input.proposal.status,
        outcome: proposalOutcome(input.proposal),
        responseNote: input.proposal.responseNote,
        paymentPath: paymentPathLabel(input.proposal.paymentPath),
        clientChosenDay: input.proposal.clientChosenDay,
        terms: PROPOSAL_TERMS,
        expectations: expectationsFor(
          input.proposal.zones.map((zone) => ({ serviceLabel: zone.service, scopeText: zone.scopeText }))
        ),
      }
    : null;

  const notIncluded: RecordNotIncluded = {
    removed: removedLines(input.trims, input.scopeRequests),
    askedNotQuoted: askedNotQuoted(input.requestedServices, input.proposal?.zones ?? []),
    declined: input.changes.filter(isDeclined),
    rule: NOT_INCLUDED_RULE,
  };

  const money = moneyOf(input);
  const messages = [...input.messages].sort((a, b) => a.at.localeCompare(b.at));
  const timeline = timelineOf(input).filter((entry) => !clientCopy || !entry.internal);

  const facts: RecordFact[] = [];
  if (input.job.number) facts.push({ label: "Job", value: input.job.number });
  facts.push({ label: "Status", value: input.job.status.replace(/_/g, " ") });
  if (input.job.evaluationDate) facts.push({ label: "Evaluated", value: shortDay(input.job.evaluationDate) });
  if (agreed) facts.push({ label: "Proposal", value: agreed.outcome });
  if (input.job.projectStart) {
    facts.push({
      label: "Work",
      value: input.job.projectEnd && input.job.projectEnd !== input.job.projectStart
        ? `${shortDay(input.job.projectStart)} to ${shortDay(input.job.projectEnd)}`
        : shortDay(input.job.projectStart),
    });
  }
  if (input.job.completedAt) facts.push({ label: "Completed", value: shortDay(input.job.completedAt) });
  if (money.dueCents != null) facts.push({ label: "Total", value: money_(money.dueCents) });
  if (money.outstandingCents != null) {
    facts.push({ label: "Outstanding", value: money.outstandingCents > 0 ? money_(money.outstandingCents) : "Nothing" });
  }

  return {
    clientCopy,
    generatedAt: input.generatedAt,
    siteMap: input.siteMap,
    business: input.business,
    job: input.job,
    customer: input.customer,
    address: input.address,
    accountManager: input.accountManager,
    title: RECORD_TITLE,
    facts,
    agreed,
    notIncluded,
    addedLater: input.changes.filter(isApproved),
    pendingChanges: input.changes.filter((change) => !isApproved(change) && !isDeclined(change)),
    communications: messages.filter((message) => !message.internal),
    internalNotes: clientCopy ? [] : messages.filter((message) => message.internal),
    objections: [...input.objections].sort((a, b) => a.at.localeCompare(b.at)),
    evalEdits: [...input.evalEdits].sort((a, b) => a.at.localeCompare(b.at)),
    scopeRequests: input.scopeRequests,
    visits: [...input.visits].sort((a, b) => a.startsOn.localeCompare(b.startsOn)),
    tickets: input.tickets,
    walkthroughs: input.walkthroughs,
    issues: clientCopy ? [] : input.issues,
    exceptions: clientCopy ? [] : input.exceptions,
    money,
    photos: input.photos,
    marks: clientCopy ? [] : input.marks,
    reading: clientCopy ? null : input.reading,
    timeline,
    walkNotes: clientCopy ? [] : walkNotesFor(input, money, agreed, notIncluded),
  };
}

/** The file a browser saves this as. */
export function recordFileName(job: Pick<RecordJob, "number">, customerName: string): string {
  const who = customerName.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "client";
  return `job-record-${job.number ? job.number.replace("#", "") + "-" : ""}${who}.pdf`;
}

export function viaLabel(via: string): string {
  const map: Record<string, string> = {
    text: "text",
    sms: "text",
    call: "phone",
    phone: "phone",
    in_person: "in person",
    office: "the office",
    email: "email",
    proposal: "the proposal page",
  };
  return map[via] ?? via.replace(/_/g, " ");
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

const money_ = money;

export function shortDay(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function longWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return (
    date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) +
    " at " +
    date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

export function whenLine(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (iso.length === 10 || /T12:00:00$/.test(iso) || /T08:00:00$/.test(iso)) return shortDay(iso);
  return (
    date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
    ", " +
    date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  );
}

function describeSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

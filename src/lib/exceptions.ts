/**
 * The thirteen ways a job does not go as sold.
 *
 * Every one of these currently ends in a phone call to the owner, and that is
 * the thing to fix. A crew member standing in a garden reports the exception
 * once, in the app; the decision it needs is routed to whoever is allowed to
 * make it; and the job carries the record afterwards. The owner stops being
 * the switchboard.
 *
 * Two rules run through the whole file.
 *
 * **Reporting is not deciding.** A field person can say what happened and
 * whether they can carry on. That is the whole of their authority. They cannot
 * price anything, they cannot agree anything with the client, and nothing they
 * write changes what the crew is contracted to do. `DECIDED_BY` below says
 * whose call each kind is, and the change-request pipeline is built so that the
 * field is structurally unable to enlarge the work.
 *
 * **An exception is a report, not a verdict.** Whether a job is *blocked* is
 * still `job_issues`' business, and a lead saying they are stuck is exactly the
 * input that should raise one -- but the two stay separate records, because
 * "the mower broke" and "this job cannot go ahead" are different claims and
 * resolving one must not silently resolve the other.
 */

import type { RoleKey } from "@/lib/roles";

export const EXCEPTION_KINDS = [
  "change_request",
  "cannot_perform",
  "partial_completion",
  "material_discrepancy",
  "equipment_failure",
  "equipment_unavailable",
  "crew_absence",
  "late_start",
  "overrun",
  "weather_interruption",
  "access_failure",
  "instruction_conflict",
  "cancellation",
] as const;

export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];

export function isExceptionKind(value: string): value is ExceptionKind {
  return (EXCEPTION_KINDS as readonly string[]).includes(value);
}

/** What a field person picks from. Their words, not the schema's. */
export const KIND_LABEL: Record<ExceptionKind, string> = {
  change_request: "Client wants something else",
  cannot_perform: "Can't do it as written",
  partial_completion: "Only got part of it done",
  material_discrepancy: "Materials aren't right",
  equipment_failure: "Equipment broke",
  equipment_unavailable: "Equipment isn't here",
  crew_absence: "Somebody isn't coming",
  late_start: "Starting late",
  overrun: "Running over",
  weather_interruption: "Stopped by weather",
  access_failure: "Can't get in",
  instruction_conflict: "Client is asking for the opposite",
  cancellation: "Called off or nobody here",
};

/** The line under the label, so nobody has to guess which one they mean. */
export const KIND_MEANS: Record<ExceptionKind, string> = {
  change_request: "They're asking for work that wasn't sold. Report it — don't do it yet.",
  cannot_perform: "The scoped work can't be done the way it's written. Say what's in the way.",
  partial_completion: "You did some of it. Record which parts and what stopped the rest.",
  material_discrepancy: "Wrong quantity, wrong product, or damaged on arrival.",
  equipment_failure: "It was working and now it isn't.",
  equipment_unavailable: "It never turned up, or somebody else has it.",
  crew_absence: "Called out, sick, or reassigned. Say who.",
  late_start: "The crew is starting later than booked.",
  overrun: "This is going to take longer than booked.",
  weather_interruption: "Work stopped or can't start because of the weather.",
  access_failure: "Locked gate, dog, blocked drive, nobody home.",
  instruction_conflict: "The client on site is contradicting what was sold.",
  cancellation: "The visit isn't happening.",
};

/**
 * Whose decision each kind is.
 *
 * A project lead settles what happens on their own site: equipment, weather,
 * a late start, how the day gets rearranged. Anything that touches what the
 * client is buying or being charged goes to the account manager -- that is the
 * boundary between running the work and selling it, and it is the boundary the
 * whole change-request pipeline exists to enforce.
 */
export const DECIDED_BY: Record<ExceptionKind, RoleKey> = {
  change_request: "account-manager",
  instruction_conflict: "account-manager",
  cancellation: "account-manager",
  cannot_perform: "account-manager",
  partial_completion: "account-manager",
  material_discrepancy: "project-lead",
  equipment_failure: "project-lead",
  equipment_unavailable: "project-lead",
  crew_absence: "project-lead",
  late_start: "project-lead",
  overrun: "project-lead",
  weather_interruption: "project-lead",
  access_failure: "project-lead",
};

/**
 * Whether reporting this normally means the crew has stopped.
 *
 * A default the reporter can change either way, not a rule. Somebody who can
 * carry on while a second mower is fetched should say so, and somebody who
 * cannot get through a gate is stopped whatever the default says.
 */
export const STOPS_WORK_BY_DEFAULT: Record<ExceptionKind, boolean> = {
  change_request: false,
  cannot_perform: true,
  partial_completion: false,
  material_discrepancy: false,
  equipment_failure: false,
  equipment_unavailable: false,
  crew_absence: false,
  late_start: false,
  overrun: false,
  weather_interruption: true,
  access_failure: true,
  instruction_conflict: true,
  cancellation: true,
};

/**
 * Kinds that mean the sold work changed, and therefore cannot be settled in
 * the field at all: each one opens a change request.
 */
export const OPENS_A_CHANGE_REQUEST: ExceptionKind[] = ["change_request", "instruction_conflict"];

export const EXCEPTION_STATES = ["reported", "acknowledged", "resolved", "dismissed"] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];

const EXCEPTION_NEXT: Record<ExceptionState, ExceptionState[]> = {
  reported: ["acknowledged", "resolved", "dismissed"],
  acknowledged: ["resolved", "dismissed"],
  // Closed is closed. Something new is a new report, which keeps the history
  // of what was decided the first time.
  resolved: [],
  dismissed: [],
};

export function canMoveException(from: ExceptionState, to: ExceptionState): boolean {
  return EXCEPTION_NEXT[from].includes(to);
}

export function isExceptionOpen(state: ExceptionState): boolean {
  return state === "reported" || state === "acknowledged";
}

/* -------------------------------------------------------------------------
 * Change requests
 * ---------------------------------------------------------------------- */

export const SCOPE_CHANGE_STATUSES = [
  "reported",
  "in_review",
  "priced",
  "sent_to_client",
  "client_approved",
  "client_declined",
  "rejected",
  "withdrawn",
  "superseded",
] as const;

export type ScopeChangeStatus = (typeof SCOPE_CHANGE_STATUSES)[number];

export const SCOPE_STATUS_LABEL: Record<ScopeChangeStatus, string> = {
  reported: "Reported from the field",
  in_review: "With the account manager",
  priced: "Priced, not sent yet",
  sent_to_client: "With the client",
  client_approved: "Approved — crew can do it",
  client_declined: "Client said no",
  rejected: "Not offered",
  withdrawn: "Withdrawn",
  superseded: "Replaced by a newer version",
};

/**
 * The pipeline, as the only route by which the work a crew is asked to do can
 * grow: reported → reviewed → priced if there is a charge → the client says
 * yes → executable.
 *
 * `priced` can be skipped, because plenty of changes cost nothing and making
 * somebody type a zero is how a step gets skipped for real. Nothing else can
 * be skipped: no path reaches the client without a review, and none reaches
 * approval without a recorded decision. The database holds the same shape in
 * check constraints, so this is a description of the truth rather than the
 * only place it is kept.
 */
const SCOPE_NEXT: Record<ScopeChangeStatus, ScopeChangeStatus[]> = {
  reported: ["in_review", "withdrawn", "rejected"],
  in_review: ["priced", "sent_to_client", "client_approved", "rejected", "withdrawn", "superseded"],
  priced: ["sent_to_client", "client_approved", "in_review", "rejected", "withdrawn", "superseded"],
  sent_to_client: ["client_approved", "client_declined", "in_review", "withdrawn", "superseded"],
  client_approved: ["superseded"],
  client_declined: ["superseded"],
  rejected: [],
  withdrawn: [],
  superseded: [],
};

export function canMoveScopeChange(from: ScopeChangeStatus, to: ScopeChangeStatus): boolean {
  return SCOPE_NEXT[from].includes(to);
}

/** Still going somewhere: it is on somebody's desk. */
export function isScopeChangeOpen(status: ScopeChangeStatus): boolean {
  return ["reported", "in_review", "priced", "sent_to_client"].includes(status);
}

/** Whose desk it is on right now, so a board can say so rather than only that it is open. */
export function waitingOn(status: ScopeChangeStatus): "account-manager" | "client" | null {
  if (status === "reported" || status === "in_review" || status === "priced") return "account-manager";
  if (status === "sent_to_client") return "client";
  return null;
}

export interface ScopeChangeShape {
  status: ScopeChangeStatus;
  reviewedAt: string | null;
  priceCents: number | null;
  pricedAt: string | null;
  clientApprovalRequired: boolean;
  approvalWaivedReason: string | null;
  clientDecision: "approved" | "declined" | null;
  executableAt: string | null;
}

/**
 * Whether a crew may actually do this yet.
 *
 * The single question the Field tab asks, and the reason the field cannot
 * enlarge its own work: a change is executable only once it is approved and
 * stamped, and only the review-and-approve path can stamp it.
 */
export function isExecutable(change: ScopeChangeShape): boolean {
  return change.status === "client_approved" && change.executableAt != null;
}

/**
 * What is missing before this can be sent to a client, in a sentence somebody
 * can act on.
 *
 * Returns null when it is ready to go. Never guesses: a change with no price
 * is only ready if somebody has said it is free, which is what `pricedAt` with
 * a null `priceCents` means.
 */
export function blocksSending(change: ScopeChangeShape): string | null {
  if (change.status === "reported") return "An account manager has not reviewed it yet.";
  if (change.reviewedAt == null) return "It has not been reviewed.";
  if (change.priceCents == null && change.pricedAt == null) {
    return "No price yet, and nobody has said it is free.";
  }
  return null;
}

/**
 * Whether skipping the client is allowed on this one.
 *
 * A few changes genuinely do not need a client's yes -- they are the one who
 * asked, standing there, and it costs nothing. Waiving is a decision an
 * account manager makes and has to justify, and it can never be waived on
 * something the client is being charged for.
 */
export function canWaiveClientApproval(priceCents: number | null): boolean {
  return priceCents == null || priceCents === 0;
}

/* -------------------------------------------------------------------------
 * Partial completion
 * ---------------------------------------------------------------------- */

export const PROGRESS_STATES = [
  "not_started",
  "in_progress",
  "complete",
  "partial",
  "cannot_perform",
  "skipped",
] as const;

export type ProgressState = (typeof PROGRESS_STATES)[number];

export const PROGRESS_LABEL: Record<ProgressState, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Done",
  partial: "Partly done",
  cannot_perform: "Couldn't do it",
  skipped: "Skipped",
};

/** States that have to say why, because the bare fact is not usable on its own. */
export function progressNeedsReason(state: ProgressState): boolean {
  return state === "partial" || state === "cannot_perform" || state === "skipped";
}

export interface ProgressUnit {
  unitKind: "zone" | "service" | "task";
  unitKey: string;
  unitLabel: string | null;
  state: ProgressState;
  portionPct: number | null;
  note: string | null;
}

export interface ProgressSummary {
  total: number;
  done: number;
  short: number;
  outstanding: number;
  /** Everything scoped is accounted for, one way or another. */
  accountedFor: boolean;
  /** Everything scoped was actually done. */
  fullyDone: boolean;
  /** A sentence for a card, or null when there is nothing to say. */
  sentence: string | null;
}

/**
 * What a list of units adds up to.
 *
 * The distinction that matters is between *done* and *accounted for*. Three of
 * four zones done and the fourth recorded as flooded is a job somebody can
 * close out and invoice honestly; three of four with the fourth untouched is a
 * job with a hole in it. Collapsing those two into one number is how a crew
 * gets blamed for something they wrote down.
 */
export function summariseProgress(units: readonly ProgressUnit[]): ProgressSummary {
  const total = units.length;
  const done = units.filter((u) => u.state === "complete").length;
  const short = units.filter((u) => u.state === "partial" || u.state === "cannot_perform" || u.state === "skipped").length;
  const outstanding = units.filter((u) => u.state === "not_started" || u.state === "in_progress").length;

  let sentence: string | null = null;
  if (total === 0) sentence = null;
  else if (done === total) sentence = `All ${total} done.`;
  else if (outstanding > 0) sentence = `${done} of ${total} done, ${outstanding} still open.`;
  else sentence = `${done} of ${total} done, ${short} recorded short.`;

  return {
    total,
    done,
    short,
    outstanding,
    accountedFor: total > 0 && outstanding === 0,
    fullyDone: total > 0 && done === total,
    sentence,
  };
}

/* -------------------------------------------------------------------------
 * Who may do what
 * ---------------------------------------------------------------------- */

/** Anybody who can open the job can report. Reporting is never gated. */
export function canReportException(): boolean {
  return true;
}

/**
 * Whether these roles can settle this kind of exception.
 *
 * Owner-level can settle anything -- somebody has to be able to, at nine on a
 * Sunday. Otherwise it is the role the kind is routed to, and an account
 * manager can settle a project lead's kinds because the money side is the
 * stricter one and it contains the operational side.
 */
export function canDecideException(roleKeys: readonly RoleKey[], kind: ExceptionKind): boolean {
  if (roleKeys.includes("owner")) return true;
  const needed = DECIDED_BY[kind];
  if (roleKeys.includes(needed)) return true;
  return needed === "project-lead" && roleKeys.includes("account-manager");
}

/** Reviewing, pricing and offering a change is selling. It is not a field job. */
export function canReviewScopeChange(roleKeys: readonly RoleKey[]): boolean {
  return roleKeys.includes("owner") || roleKeys.includes("account-manager");
}

/**
 * Which automatic emails wait for the owner, and which go on their own.
 *
 * One switch used to hold every email the app wrote. Of 132 held, 53 were
 * ever sent: 51 were declined and 24 sat unread until they were too late.
 * Most of what waited was the same booking confirmation and visit reminder
 * the owner had already approved dozens of times. So each kind of email now
 * has its own setting:
 *
 * - auto: proven, transactional wording goes straight out;
 * - hold: waits for the owner and is dropped if nobody answers in time;
 * - hold_then_send: waits for the owner, and goes on its own if nobody has
 *   said no by the time the owner's window closes.
 *
 * Three things are always held whatever the kind says: anything an AI wrote
 * as free text, a request to somebody on the team, and the first send of a
 * kind the business has never sent (or whose wording changed since it last
 * went). The old org-wide switch still works as a master hold: while it is
 * on, everything waits and nothing sends itself, exactly as before.
 *
 * Pure: no reads, no writes.
 */

export const APPROVAL_MODES = ["auto", "hold", "hold_then_send"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export function isApprovalMode(value: string): value is ApprovalMode {
  return (APPROVAL_MODES as readonly string[]).includes(value);
}

export const MODE_LABEL: Record<ApprovalMode, string> = {
  auto: "Sends on its own",
  hold: "Waits for you",
  hold_then_send: "Waits, then sends if you don't stop it",
};

/**
 * The kinds that go on their own unless the owner says otherwise.
 *
 * Patterns rather than a fixed list, because other parts of the app add
 * kinds (a dunning step, a review ask) and a new one should land in the
 * right bucket without a change here. Matched in order; first wins.
 */
const LOW_RISK_PATTERNS: RegExp[] = [
  /^evaluation_confirmed$/,
  /^evaluation_reminder$/,
  /^evaluation_(booked|two_days|day_before|morning_of|after)$/,
  /^job_start_reminder$/,
  /^thank_?you/,
  /_thank_?you$/,
  /^proposal_follow_up$/,
  /^invoice_(reminder|due|overdue|pre_due|nudge|dunning)/,
  /^review_request/,
];

/** Kinds that always wait, whatever their stored mode says. */
const ALWAYS_HOLD_KINDS = new Set(["team_request", "measurements_request"]);

/** Whether a kind is one of the transactional, low-risk ones. */
export function isLowRisk(kind: string): boolean {
  return LOW_RISK_PATTERNS.some((p) => p.test(kind));
}

/** What a kind does before anybody changes it. Unknown kinds wait. */
export function defaultModeFor(kind: string): ApprovalMode {
  if (ALWAYS_HOLD_KINDS.has(kind)) return "hold";
  return isLowRisk(kind) ? "auto" : "hold";
}

/** The kinds the settings screen lists, in the order a person thinks of them. */
export const KNOWN_KINDS: string[] = [
  "evaluation_booked",
  "evaluation_confirmed",
  "evaluation_two_days",
  "evaluation_day_before",
  "evaluation_reminder",
  "evaluation_morning_of",
  "evaluation_after",
  "proposal_follow_up",
  "job_start_reminder",
  "invoice_reminder",
  "review_request",
  "thank_you",
  "measurements_request",
];

export interface HoldInput {
  /** organizations.require_email_approval: the old switch, now the master hold. */
  masterHold: boolean;
  kind: string;
  /** The stored mode for this kind, if the owner has set one. */
  storedMode: ApprovalMode | null;
  /** Written by an AI as free text rather than from a fixed template. */
  aiWritten?: boolean;
  /** A note to somebody on the team rather than a client. */
  teamRequest?: boolean;
  /**
   * This kind has never gone out from this business, or its wording was
   * changed after it last did. Null when it could not be checked; treated
   * as proven, because an unreadable history is not a reason to stop mail.
   */
  firstSend?: boolean | null;
}

export type HoldReason = "master" | "ai_written" | "team_request" | "first_send" | "policy";

export type HoldDecision =
  | { hold: false; mode: ApprovalMode }
  | { hold: true; mode: ApprovalMode; reason: HoldReason; sendOnExpiry: boolean };

/**
 * Whether one email waits, and whether it goes on its own if nobody answers.
 *
 * Sent unread only when the kind is set to hold_then_send, or is a low-risk
 * kind held for its first send. An AI's words, a team request and a kind
 * the owner set to plain hold always need a person, and the master hold
 * means what the owner chose it to mean: everything waits, nothing sends
 * itself.
 */
export function decideHold(input: HoldInput): HoldDecision {
  const mode = ALWAYS_HOLD_KINDS.has(input.kind) ? "hold" : (input.storedMode ?? defaultModeFor(input.kind));
  if (input.masterHold) return { hold: true, mode, reason: "master", sendOnExpiry: false };
  if (input.aiWritten) return { hold: true, mode, reason: "ai_written", sendOnExpiry: false };
  if (input.teamRequest || ALWAYS_HOLD_KINDS.has(input.kind)) return { hold: true, mode, reason: "team_request", sendOnExpiry: false };
  if (mode === "hold") return { hold: true, mode, reason: "policy", sendOnExpiry: false };
  // A low-risk kind's first send waits for a look, but a booking
  // confirmation nobody got round to reading is better sent than dropped.
  if (input.firstSend) return { hold: true, mode, reason: "first_send", sendOnExpiry: isLowRisk(input.kind) };
  if (mode === "hold_then_send") return { hold: true, mode, reason: "policy", sendOnExpiry: true };
  return { hold: false, mode };
}

export const HOLD_REASON_LABEL: Record<HoldReason, string> = {
  master: "Every email waits (master hold is on)",
  ai_written: "Written by AI",
  team_request: "Request to the team",
  first_send: "First time this email goes out",
  policy: "Set to wait",
};

const HOUR = 60 * 60 * 1000;

/**
 * When a held, send-on-expiry email goes on its own.
 *
 * Half of the time it stays worth sending, capped at twelve hours and never
 * under one, so a "see you tomorrow" still lands before tomorrow and a
 * proposal follow-up gives the owner the working day to stop it. Returns
 * null when there is no room left to wait at all.
 */
export function autoSendAt(now: Date, staleAt: Date | null): Date | null {
  if (!staleAt) return new Date(now.getTime() + 12 * HOUR);
  const room = staleAt.getTime() - now.getTime();
  if (room <= 0) return null;
  const wait = Math.min(12 * HOUR, Math.max(HOUR, room / 2));
  const at = new Date(now.getTime() + wait);
  return at.getTime() < staleAt.getTime() ? at : null;
}

/** Whether a pending held email should go now, on its own. */
export function dueToAutoSend(
  row: { sendOnExpiry: boolean; autoSendAt: string | null; expiresAt: string | null },
  now: Date
): boolean {
  if (!row.sendOnExpiry || !row.autoSendAt) return false;
  if (new Date(row.autoSendAt).getTime() > now.getTime()) return false;
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) return false;
  return true;
}

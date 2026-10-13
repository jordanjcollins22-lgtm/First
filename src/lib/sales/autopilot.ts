/**
 * The pipeline autopilot's settings and its one decision: for a proposal
 * drafted from a submitted evaluation, approve and send it, approve it only,
 * hold it for a person, or leave it alone.
 *
 * Every automation in the app follows the same three rules, and this one
 * states them in code:
 *
 * - **It has an off switch.** Auto-approve and auto-send are separate
 *   switches, both on by default, because the report's whole case is that the
 *   approval gate costs close rate.
 * - **It goes live at a moment.** `startedAt` is written the first time the
 *   settings are read or switched on, and only evaluations submitted after it
 *   are touched. The three proposals already waiting, and anything older, stay
 *   exactly where they are until a person moves them. That is the go-live
 *   guard: turning this on never sends the backlog.
 * - **It is idempotent.** The send is keyed on the job and the moment the
 *   draft was generated, so a second run (or the cron and the submit button
 *   racing) cannot send twice; `sendClientMessage` refuses a used key.
 *
 * Pure, so the rules are tested without a database.
 */

import { DEFAULT_DIVISION_TARGETS, readTargets, type DivisionTargets } from "@/lib/sales/divisions";
import { DEFAULT_FORMULA_TOLERANCE } from "@/lib/sales/price-guardrails";
import { DEFAULT_SPEED_TARGET_HOURS } from "@/lib/sales/speed-to-proposal";

export interface AutopilotSettings {
  /** Approve a proposal that passes the guardrails, so its link is live. */
  autoApprove: boolean;
  /** And email it to the client straight away. Needs autoApprove. */
  autoSend: boolean;
  /** The go-live moment: nothing submitted before it is touched. Null until the settings are first saved. */
  startedAt: string | null;
  targets: DivisionTargets;
  tolerance: number;
  speedTargetHours: number;
  /** Raise an exception to the evaluator when a proposal is past the speed target. */
  overdueExceptions: boolean;
  /** When overdue exceptions went live: only evaluations submitted after it can raise one. */
  overdueStartedAt: string | null;
  /** Offer Good / Better / Best on proposals the autopilot sends. */
  offerOptions: boolean;
  /** The business's Maryland Home Improvement Commission licence number, for the contract block. */
  mhicLicense: string | null;
}

export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  autoApprove: true,
  autoSend: true,
  startedAt: null,
  targets: DEFAULT_DIVISION_TARGETS,
  tolerance: DEFAULT_FORMULA_TOLERANCE,
  speedTargetHours: DEFAULT_SPEED_TARGET_HOURS,
  overdueExceptions: true,
  overdueStartedAt: null,
  offerOptions: false,
  mhicLicense: null,
};

/** The stored row, as the database names it. */
export interface AutopilotRow {
  auto_approve: boolean | null;
  auto_send: boolean | null;
  started_at: string | null;
  margin_maintenance: number | null;
  margin_install: number | null;
  margin_snow: number | null;
  margin_irrigation: number | null;
  formula_tolerance: number | null;
  speed_target_hours: number | null;
  overdue_exceptions: boolean | null;
  overdue_started_at: string | null;
  offer_options: boolean | null;
  mhic_license: string | null;
}

export function readAutopilot(row: Partial<AutopilotRow> | null | undefined): AutopilotSettings {
  if (!row) return { ...DEFAULT_AUTOPILOT };
  const num = (v: unknown, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return v != null && Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  return {
    autoApprove: row.auto_approve ?? DEFAULT_AUTOPILOT.autoApprove,
    autoSend: row.auto_send ?? DEFAULT_AUTOPILOT.autoSend,
    startedAt: row.started_at ?? null,
    targets: readTargets({
      maintenance: row.margin_maintenance,
      install: row.margin_install,
      snow: row.margin_snow,
      irrigation: row.margin_irrigation,
    }),
    tolerance: num(row.formula_tolerance, DEFAULT_FORMULA_TOLERANCE, 0.01, 0.5),
    speedTargetHours: num(row.speed_target_hours, DEFAULT_SPEED_TARGET_HOURS, 0.25, 72),
    overdueExceptions: row.overdue_exceptions ?? DEFAULT_AUTOPILOT.overdueExceptions,
    overdueStartedAt: row.overdue_started_at ?? null,
    offerOptions: row.offer_options ?? DEFAULT_AUTOPILOT.offerOptions,
    mhicLicense: row.mhic_license?.trim() || null,
  };
}

export interface ProposalFacts {
  status: string;
  /** When the evaluation was submitted. */
  submittedAt: string | null;
  /** When the client got it, if they have. */
  sentAt: string | null;
  /** The guardrails passed. */
  passes: boolean;
  /** There is an email to send it to. */
  hasEmail: boolean;
}

export type AutopilotAction =
  | { kind: "ignore"; why: string }
  | { kind: "hold"; why: string }
  | { kind: "approve"; why: string }
  | { kind: "approve_and_send"; why: string };

/** Whether something submitted at this moment is after the go-live. */
export function afterGoLive(submittedAt: string | null, startedAt: string | null): boolean {
  if (!submittedAt || !startedAt) return false;
  return new Date(submittedAt).getTime() >= new Date(startedAt).getTime();
}

export function decide(settings: AutopilotSettings, facts: ProposalFacts): AutopilotAction {
  if (facts.status !== "needs_approval") return { kind: "ignore", why: "Not waiting on approval." };
  if (!settings.autoApprove) return { kind: "ignore", why: "Auto-approve is off." };
  if (!settings.startedAt) return { kind: "ignore", why: "The autopilot hasn't gone live yet." };
  if (!facts.submittedAt) return { kind: "ignore", why: "The evaluation hasn't been submitted." };
  if (!afterGoLive(facts.submittedAt, settings.startedAt)) return { kind: "ignore", why: "Submitted before the autopilot went live, so a person sends it." };
  if (!facts.passes) return { kind: "hold", why: "Outside the guardrails." };
  if (!settings.autoSend) return { kind: "approve", why: "Inside the guardrails. Auto-send is off, so it waits for Send to client." };
  if (!facts.hasEmail) return { kind: "approve", why: "Inside the guardrails, but the client has no email on file. Text them the link." };
  return { kind: "approve_and_send", why: "Inside the guardrails." };
}

/** The send's key: one per draft, so it can never go twice. */
export function sendKey(jobId: string, generatedAt: string): string {
  return `proposal_autosend:${jobId}:${generatedAt}`;
}

/**
 * Where a switch's go-live moment stands after a save: kept when it was
 * already set, written now when the switch is being turned on, left empty
 * while it is off.
 */
export function goLiveAfterSave(previous: string | null, turningOn: boolean, now: Date): string | null {
  if (previous) return previous;
  return turningOn ? now.toISOString() : null;
}

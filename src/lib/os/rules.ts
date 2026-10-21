/**
 * The rules the backbone runs, at their built-in defaults.
 *
 * Every number here is a default, labelled as one, and a business can change
 * it with a row in automation_rules. Nothing here is universal policy: three
 * days before a follow-up is what this business does now, not what a
 * landscaper must do.
 */

import { DEFAULT_CONFIG } from "@/lib/client-automations/settings";

export type AutomationMode = "auto_allowed" | "approval_required" | "human_only" | "paused";

export interface RuleDefinition<P> {
  ruleId: string;
  version: number;
  /** Default mode. Anything that writes to a client starts needing a person. */
  mode: AutomationMode;
  params: P;
}

export interface FollowUpParams {
  /** Days after sending, one touch each. Default: the existing sequence's own. */
  days: number[];
  /** Hard ceiling on touches, whatever days says. */
  maxTouches: number;
  /** A touch more than this late is let go rather than sent late. */
  lateWindowHours: number;
}

export const proposalFollowUpV1: RuleDefinition<FollowUpParams> = {
  ruleId: "proposal_followup",
  version: 1,
  mode: "approval_required",
  params: { days: [...DEFAULT_CONFIG.followUpDays], maxTouches: 5, lateWindowHours: 24 },
};

export interface EstimateDeadlineParams {
  /** Hours from the evaluation to a proposal being out, before it is escalated. */
  hours: number;
}

export const estimateDeadlineV1: RuleDefinition<EstimateDeadlineParams> = {
  ruleId: "estimate_deadline",
  version: 1,
  mode: "human_only",
  params: { hours: 48 },
};

export interface ApprovalParams {
  /** Checks that scheduling itself produces, so they cannot hold scheduling up. */
  schedulingOutputs: string[];
}

export const estimateApprovedV1: RuleDefinition<ApprovalParams> = {
  ruleId: "estimate_approved",
  version: 1,
  mode: "human_only",
  params: { schedulingOutputs: ["scheduled", "crew", "work-order"] },
};

export interface AppointmentParams {
  /** How long a booked visit may sit unconfirmed before the task is due. */
  confirmWithinHours: number;
  /** How long a new lead may wait for a visit to be booked. */
  bookWithinHours: number;
}

export const appointmentV1: RuleDefinition<AppointmentParams> = {
  ruleId: "appointment",
  version: 1,
  mode: "human_only",
  params: { confirmWithinHours: 24, bookWithinHours: 24 },
};

/** Backoff for a delivery or an action that failed: 1, 4, 16, 64 minutes. */
export function retryDelayMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(4 ** (n - 1), 256) * 60_000;
}

/** Merge a business's stored params over the defaults, ignoring anything malformed. */
export function withParams<P extends object>(rule: RuleDefinition<P>, stored: unknown, mode?: AutomationMode | null): RuleDefinition<P> {
  const extra: Partial<P> = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as Partial<P>) : {};
  const params = { ...rule.params } as P;
  for (const key of Object.keys(rule.params) as (keyof P)[]) {
    const value = extra[key];
    if (value !== undefined && typeof value === typeof rule.params[key] && Array.isArray(value) === Array.isArray(rule.params[key])) {
      params[key] = value as P[keyof P];
    }
  }
  return { ...rule, params, mode: mode ?? rule.mode };
}

import type { JourneyStep } from "@/types/domain";

export interface JourneyMetrics {
  totalSteps: number;
  totalClicks: number;
  manualInputs: number;
  automatedActions: number;
  humanApprovals: number;
  customerComms: number;
  internalComms: number;
  texts: number;
  emails: number;
  calls: number;
  avgMinutesBetweenSteps: number | null;
  totalMinutes: number | null;
  notBuiltCount: number;
}

/** Every number the dashboard shows is just a sum/average over the journey's own step data — nothing hidden. */
export function computeJourneyMetrics(steps: JourneyStep[]): JourneyMetrics {
  const timed = steps.filter((s) => s.est_minutes != null);
  const totalMinutes = timed.length > 0 ? timed.reduce((sum, s) => sum + (s.est_minutes ?? 0), 0) : null;

  return {
    totalSteps: steps.length,
    totalClicks: steps.reduce((sum, s) => sum + s.clicks, 0),
    manualInputs: steps.reduce((sum, s) => sum + s.manual_inputs, 0),
    automatedActions: steps.filter((s) => s.step_type === "automated" || s.step_type === "system_action").length,
    humanApprovals: steps.filter((s) => s.step_type === "human_approval").length,
    customerComms: steps.reduce((sum, s) => sum + s.customer_comms, 0),
    internalComms: steps.reduce((sum, s) => sum + s.internal_comms, 0),
    texts: steps.reduce((sum, s) => sum + s.texts, 0),
    emails: steps.reduce((sum, s) => sum + s.emails, 0),
    calls: steps.reduce((sum, s) => sum + s.calls, 0),
    avgMinutesBetweenSteps: timed.length > 0 ? (totalMinutes as number) / timed.length : null,
    totalMinutes,
    notBuiltCount: steps.filter((s) => !s.is_built).length,
  };
}

export const STEP_TYPE_LABELS: Record<JourneyStep["step_type"], string> = {
  human: "HUMAN",
  automated: "AUTOMATED",
  human_approval: "HUMAN APPROVAL",
  customer_action: "CUSTOMER ACTION",
  system_action: "SYSTEM ACTION",
};

export const STEP_TYPE_STYLES: Record<JourneyStep["step_type"], string> = {
  human: "border-blue-500/40 bg-blue-500/10 text-blue-700",
  automated: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  human_approval: "border-amber-500/40 bg-amber-500/10 text-amber-700",
  customer_action: "border-purple-500/40 bg-purple-500/10 text-purple-700",
  system_action: "border-slate-500/40 bg-slate-500/10 text-slate-700",
};

/**
 * Whether a job can move on, and if not, exactly what to do about it.
 *
 * "Ready" was a dropdown somebody set. That is not a fact about a job, it is a
 * claim about one, and the two come apart the morning a crew drives to a house
 * with no mulch on the truck. So Ready is computed here, from the job, every
 * time it is asked -- and the answer is never a yes or a no on its own. It is
 * the list of checks with ticks and crosses against them, because a person
 * looking at NOT READY needs to know which one thing to go and fix.
 *
 * Two rules keep this honest.
 *
 * A check that fails is never quietly turned into a check that passed. Real
 * work needs exceptions -- the client rang and said the gate is open, use the
 * side path -- so a manager can override a failed check, and the override is a
 * record with their name, the time, the reason and which check it covers. The
 * check still reads as failed. It reads as failed *and overridden by Jordan at
 * 7:40am because the client confirmed access by phone*, which is the true
 * thing and is what somebody wants to see three weeks later.
 *
 * And not everything missing is a blocker. A gate that stops the work for
 * every empty field is a gate people learn to route around. Only things that
 * actually stop a crew block; the rest warn.
 */

import { blockingStage, type BlockingStage, type Issue } from "@/lib/issues";

export type GateKey = "proposal" | "booking" | "ready" | "start" | "closeout" | "completed";

export interface GateCheck {
  key: string;
  label: string;
  passed: boolean;
  /**
   * Whether failing it stops the job. A check that only warns is shown and
   * counted, and the gate opens anyway.
   */
  blocking: boolean;
  /** What is wrong and what would fix it. Shown to the person, not logged. */
  reason?: string;
}

export interface GateOverride {
  /** The check it covers. */
  checkKey: string;
  reason: string;
  byId: string | null;
  byName: string | null;
  at: string;
}

export interface CheckResult extends GateCheck {
  /** The override standing against this check, when one is. */
  override: GateOverride | null;
  /** Failed, and neither passing nor overridden: this is what is stopping it. */
  stopping: boolean;
}

export interface GateResult {
  gate: GateKey;
  /** Every check, passed or not, in the order they are worth reading. */
  checks: CheckResult[];
  /** Open issues holding this gate. */
  blockingIssues: Issue[];
  /** Nothing blocking is failing, and no blocking issue is open. */
  open: boolean;
  /** Failing checks that only warn. The gate opens; somebody should still look. */
  warnings: CheckResult[];
  /** What is actually stopping it, in words. */
  stoppers: CheckResult[];
}

/** The facts a gate is decided from. Assembled by the data layer, judged here. */
export interface JobFacts {
  status: string;
  proposalAccepted: boolean;
  depositSatisfied: boolean;
  scheduled: boolean;
  crewAssigned: boolean;
  workOrderReady: boolean;
  materialsConfirmed: boolean;
  accessConfirmed: boolean;
  measurementsPresent: boolean;
  scopeDocumented: boolean;
  beforePhotos: number;
  afterPhotos: number;
  walkthroughDone: boolean;
  invoiceRaised: boolean;
  /** Optional, so a job with no money owed is not held up by a payment check. */
  balanceOutstanding: number | null;
}

const GATE_ORDER: readonly GateKey[] = ["proposal", "booking", "ready", "start", "closeout", "completed"];

export const GATE_LABEL: Record<GateKey, string> = {
  proposal: "Ready to quote",
  booking: "Ready to book",
  ready: "Ready to start",
  start: "Start the job",
  closeout: "Field work complete",
  completed: "Fully closed",
};

/**
 * The checks each gate makes.
 *
 * `blocking` is the judgment call the brief asks for: only what actually stops
 * a crew. Measurements missing stops a proposal, because a quote without them
 * is a guess. Photos missing at closeout only warns, because the work is done
 * and chasing a photo is not a reason to leave a job open for a week.
 */
function checksFor(gate: GateKey, facts: JobFacts): GateCheck[] {
  switch (gate) {
    case "proposal":
      return [
        {
          key: "measurements",
          label: "Measurements taken",
          passed: facts.measurementsPresent,
          blocking: true,
          reason: "Draw the site plan on the job's Site plan tab.",
        },
        {
          key: "scope",
          label: "Scope written down",
          passed: facts.scopeDocumented,
          blocking: true,
          reason: "Add the services being quoted on the Scope tab.",
        },
        {
          key: "eval-photos",
          label: "Photos from the evaluation",
          passed: facts.beforePhotos > 0,
          blocking: false,
          reason: "No photos yet. A quote without them is harder to defend later.",
        },
      ];

    case "booking":
      return [
        {
          key: "accepted",
          label: "Proposal accepted",
          passed: facts.proposalAccepted,
          blocking: true,
          reason: "The client has not accepted the proposal.",
        },
        {
          key: "deposit",
          label: "Required payment satisfied",
          passed: facts.depositSatisfied,
          blocking: true,
          reason: "The deposit or payment condition on this job is not met.",
        },
      ];

    case "ready":
      return [
        {
          key: "accepted",
          label: "Proposal accepted",
          passed: facts.proposalAccepted,
          blocking: true,
          reason: "The client has not accepted the proposal.",
        },
        {
          key: "deposit",
          label: "Required payment satisfied",
          passed: facts.depositSatisfied,
          blocking: true,
          reason: "The deposit or payment condition on this job is not met.",
        },
        {
          key: "scheduled",
          label: "Scheduled",
          passed: facts.scheduled,
          blocking: true,
          reason: "Give the job a start date on the Plan tab.",
        },
        {
          key: "crew",
          label: "Crew assigned",
          passed: facts.crewAssigned,
          blocking: true,
          reason: "Nobody is assigned. Add the crew on the Plan tab.",
        },
        {
          key: "materials",
          label: "Materials confirmed",
          passed: facts.materialsConfirmed,
          blocking: true,
          reason: "Confirm the materials are on hand or ordered.",
        },
        {
          key: "access",
          label: "Access confirmed",
          passed: facts.accessConfirmed,
          blocking: true,
          reason: "Gate codes, parking and where the truck goes are not recorded.",
        },
        {
          key: "work-order",
          label: "Work order available",
          passed: facts.workOrderReady,
          blocking: false,
          reason: "The work order prints from the job, so this is a convenience, not a stopper.",
        },
      ];

    case "start":
      return [
        {
          key: "before-photos",
          label: "Before photos taken",
          passed: facts.beforePhotos > 0,
          blocking: true,
          reason: "Take the before photos on the Field tab before starting.",
        },
        {
          key: "crew",
          label: "Crew assigned",
          passed: facts.crewAssigned,
          blocking: true,
          reason: "Nobody is assigned to this job.",
        },
      ];

    case "closeout":
      return [
        {
          key: "after-photos",
          label: "After photos taken",
          passed: facts.afterPhotos > 0,
          blocking: true,
          reason: "Take the after photos on the Field tab.",
        },
        {
          key: "walkthrough",
          label: "Client walkthrough done",
          passed: facts.walkthroughDone,
          blocking: false,
          reason: "No walkthrough recorded. Note the exception if the client was not there.",
        },
      ];

    case "completed":
      return [
        {
          key: "after-photos",
          label: "After photos taken",
          passed: facts.afterPhotos > 0,
          blocking: true,
          reason: "Take the after photos on the Field tab.",
        },
        {
          key: "invoice",
          label: "Invoice raised",
          passed: facts.invoiceRaised,
          blocking: true,
          reason: "Raise the invoice on the Billing tab.",
        },
        {
          key: "balance",
          label: "Balance settled",
          // A job with nothing outstanding, and a job whose balance is
          // unknown, both pass: chasing money is not what "the work is
          // finished" means, and it warns rather than stops.
          passed: facts.balanceOutstanding == null || facts.balanceOutstanding <= 0,
          blocking: false,
          reason: "There is still a balance on this job.",
        },
        {
          key: "walkthrough",
          label: "Client walkthrough done, or the exception noted",
          passed: facts.walkthroughDone,
          blocking: false,
          reason: "No walkthrough recorded.",
        },
      ];
  }
}

/** Which gates come before this one, so a later gate carries the earlier ones. */
export function gatesUpTo(gate: GateKey): GateKey[] {
  const end = GATE_ORDER.indexOf(gate);
  return GATE_ORDER.slice(0, end + 1);
}

/**
 * One gate, judged.
 *
 * An override never turns a cross into a tick. It sits beside the failed check
 * and stops it stopping the job, and the check still reads as failed -- which
 * is the true thing, and is what somebody wants to see three weeks later.
 */
export function evaluateGate(
  gate: GateKey,
  facts: JobFacts,
  issues: readonly Issue[] = [],
  overrides: readonly GateOverride[] = []
): GateResult {
  const byCheck = new Map(overrides.map((o) => [o.checkKey, o]));

  const checks: CheckResult[] = checksFor(gate, facts).map((check) => {
    const override = byCheck.get(check.key) ?? null;
    return {
      ...check,
      override,
      stopping: !check.passed && check.blocking && override == null,
    };
  });

  const held = blockingStage(issues, gate as BlockingStage);
  const stoppers = checks.filter((check) => check.stopping);
  const warnings = checks.filter((check) => !check.passed && !check.blocking);

  return {
    gate,
    checks,
    blockingIssues: held,
    open: stoppers.length === 0 && held.length === 0,
    warnings,
    stoppers,
  };
}

/**
 * Whether a job is Ready to start, in the sense the Jobs board means it.
 *
 * Sold work that has passed every blocking pre-start check and has no blocking
 * issue open. Nothing is stored: ask again after somebody confirms the mulch
 * and the answer changes on its own.
 */
export function isReady(facts: JobFacts, issues: readonly Issue[], overrides: readonly GateOverride[]): boolean {
  if (facts.status !== "approved") return false;
  return evaluateGate("ready", facts, issues, overrides).open;
}

/** One line for a list: ready, or the count of what is stopping it. */
export function readinessLine(result: GateResult): string {
  if (result.open) return "Ready";
  const parts: string[] = [];
  if (result.stoppers.length > 0) {
    parts.push(`${result.stoppers.length} ${result.stoppers.length === 1 ? "check" : "checks"} failing`);
  }
  if (result.blockingIssues.length > 0) {
    parts.push(`${result.blockingIssues.length} blocking ${result.blockingIssues.length === 1 ? "issue" : "issues"}`);
  }
  return parts.join(", ");
}

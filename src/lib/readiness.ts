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
 * Three rules keep this honest.
 *
 * **Unknown is not confirmed.** A check that needs evidence and has none fails.
 * It does not pass because nobody has reported a problem: "no material issue
 * has been raised" and "the mulch is on the truck" are not the same sentence,
 * and a crew must never be sent out on the first one. Every confirmation is
 * three-state -- not required, required and unconfirmed, or confirmed -- and
 * the middle state is a failure, not a shrug.
 *
 * **A check that does not apply is not a check.** A bush trim needs no square
 * footage, so the measurement check does not fail on it, it does not appear.
 * Applicability is read off the services the job actually sold.
 *
 * **A failing check is never quietly turned into a passing one.** Real work
 * needs exceptions -- the client rang and said the gate is open, use the side
 * path -- so a manager can override a failed check, and the override is a
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

/**
 * The three states every confirmation has.
 *
 * `required_unconfirmed` is the important one and the default. A job whose
 * materials nobody has looked at is not a job whose materials are fine.
 */
export type ConfirmationState = "not_required" | "required_unconfirmed" | "confirmed";

/** What a check came out as. */
export type CheckState = "passed" | "failed" | "warning" | "not_required" | "overridden";

export interface GateCheck {
  key: string;
  label: string;
  passed: boolean;
  /** False when the job does not need this at all: it is not shown as failing. */
  applies: boolean;
  /**
   * Whether failing it stops the job. A check that only warns is shown and
   * counted, and the gate opens anyway.
   */
  blocking: boolean;
  /** What is wrong and what would fix it. Shown to the person, not logged. */
  reason?: string;
  /** Where the answer came from, so nobody has to guess what proved it. */
  source?: string;
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
  state: CheckState;
}

export interface GateResult {
  gate: GateKey;
  /** Every check that applies, in the order they are worth reading. */
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

/**
 * The facts a gate is decided from. Assembled by the data layer, judged here.
 *
 * Everything here is either read off an authoritative record -- the services
 * sold, the stock, the payment plan, the payments received -- or is an
 * explicit confirmation somebody made. Nothing is inferred from silence.
 */
export interface JobFacts {
  status: string;

  /**
   * Whether the job says what work is being done at all.
   *
   * Everything downstream depends on it: what needs measuring, what materials
   * are needed, what tools. A job with no services is not a job needing no
   * materials, it is a job nobody has described -- so this fails first and the
   * checks that depend on it do not pretend to have an answer.
   */
  servicesDefined: boolean;
  servicesSource: string;

  /** Read off the accepted proposal, falling back to the job's status. */
  proposalAccepted: boolean;
  proposalSource: string;

  /** Whether any service on this job is priced by measurement. */
  measurementRequired: boolean;
  measurementsPresent: boolean;

  scheduled: boolean;
  crewAssigned: boolean;

  /** Whether the crew sheet can actually be produced for this job. */
  workOrderReady: boolean;
  workOrderSource: string;

  /** Three-state, derived where it can be proved and confirmed by hand where not. */
  materials: ConfirmationState;
  materialsSource: string;
  equipment: ConfirmationState;
  equipmentSource: string;
  access: ConfirmationState;
  accessSource: string;

  /** Money required before the work starts, in cents. Zero means none is. */
  depositRequiredCents: number;
  depositReceivedCents: number;
  depositSource: string;

  /** Photos by the phase they were taken in, never by kind alone. */
  evaluationPhotos: number;
  preworkPhotos: number;
  afterPhotos: number;

  walkthroughDone: boolean;
  invoiceRaised: boolean;
  /** Null when there is no invoice, so nothing is known either way. */
  balanceOutstanding: number | null;
  /** Set where somebody has decided what happens about an unpaid balance. */
  financialDisposition: string | null;
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

/** A confirmation, as a check: unknown fails, and "not needed" is not a failure. */
function fromConfirmation(
  key: string,
  label: string,
  state: ConfirmationState,
  source: string,
  reason: string
): GateCheck {
  return {
    key,
    label,
    applies: state !== "not_required",
    passed: state === "confirmed",
    blocking: true,
    source,
    reason,
  };
}

/**
 * The first question, and the one everything else waits on.
 *
 * A job with no services is not a job that needs no materials and no
 * measuring -- it is a job nobody has described yet. Saying "measurements
 * required" about it would be a guess dressed as a requirement, so this fails
 * instead and the downstream checks stay quiet until it passes.
 */
function servicesCheck(facts: JobFacts): GateCheck {
  return {
    key: "services",
    label: "Work and services defined",
    applies: true,
    passed: facts.servicesDefined,
    blocking: true,
    source: facts.servicesSource,
    reason: "Nothing says what work this job is. Add the services on the Scope tab.",
  };
}

/** Did the client accept? Asked of the proposal itself wherever there is one. */
function acceptedCheck(facts: JobFacts): GateCheck {
  return {
    key: "accepted",
    label: "Proposal accepted",
    applies: true,
    passed: facts.proposalAccepted,
    blocking: true,
    source: facts.proposalSource,
    reason: "The client has not accepted the proposal.",
  };
}

/** Money in, against money required before the work starts. */
function depositCheck(facts: JobFacts, required: boolean): GateCheck {
  return {
    key: "deposit",
    label: "Required payment satisfied",
    applies: required,
    passed: facts.depositReceivedCents >= facts.depositRequiredCents,
    blocking: true,
    source: facts.depositSource,
    reason: `${money(facts.depositRequiredCents - facts.depositReceivedCents)} of the deposit is still outstanding.`,
  };
}

/**
 * The checks each gate makes.
 *
 * `blocking` is the judgment call: only what actually stops a crew. Missing
 * measurements stop a proposal for a service priced by the square foot,
 * because a quote without them is a guess -- and do not exist at all for a
 * bush trim. A missing work order only warns, because it prints on demand.
 */
function checksFor(gate: GateKey, facts: JobFacts): GateCheck[] {
  const depositRequired = facts.depositRequiredCents > 0;

  switch (gate) {
    case "proposal":
      return [
        servicesCheck(facts),
        {
          key: "measurements",
          label: "Measurements taken",
          // Only once the work is described. An undefined job is not a job
          // needing no measurements; the check above is what fails.
          applies: facts.servicesDefined && facts.measurementRequired,
          passed: facts.measurementsPresent,
          blocking: true,
          source: "The site plan, against the pricing basis of the services sold",
          reason: "A service on this job is priced by measurement. Draw it on the Site plan tab.",
        },
        {
          key: "eval-photos",
          label: "Photos from the evaluation",
          applies: true,
          passed: facts.evaluationPhotos > 0,
          blocking: false,
          source: "Job photos taken during the evaluation",
          reason: "No photos from the evaluation. A quote without them is harder to defend later.",
        },
      ];

    case "booking":
      return [acceptedCheck(facts), depositCheck(facts, depositRequired)];

    case "ready":
      return [
        servicesCheck(facts),
        acceptedCheck(facts),
        depositCheck(facts, depositRequired),
        {
          key: "scheduled",
          label: "Scheduled",
          applies: true,
          passed: facts.scheduled,
          blocking: true,
          source: "The job's start date",
          reason: "Give the job a start date on the Plan tab.",
        },
        {
          key: "crew",
          label: "Crew assigned",
          applies: true,
          passed: facts.crewAssigned,
          blocking: true,
          source: "The job's crew",
          reason: "Nobody is assigned. Add the crew on the Plan tab.",
        },
        fromConfirmation(
          "materials",
          "Materials confirmed for this job",
          facts.servicesDefined ? facts.materials : "required_unconfirmed",
          facts.materialsSource,
          "Nobody has confirmed the materials for this job. Confirm them on the Plan tab."
        ),
        fromConfirmation(
          "equipment",
          "Equipment confirmed for this job",
          facts.servicesDefined ? facts.equipment : "required_unconfirmed",
          facts.equipmentSource,
          "Nobody has confirmed the equipment for this job. Confirm it on the Plan tab."
        ),
        fromConfirmation(
          "access",
          "Access confirmed",
          facts.access,
          facts.accessSource,
          "Gate codes, parking and where the truck goes are not recorded. Confirm them on the Plan tab."
        ),
        {
          key: "work-order",
          label: "Work order available",
          applies: true,
          passed: facts.workOrderReady,
          blocking: false,
          source: facts.workOrderSource,
          reason: "The crew sheet cannot be produced yet. It is a convenience, not a stopper.",
        },
      ];

    case "start":
      return [
        {
          key: "before-photos",
          label: "Before photos taken on site today",
          applies: true,
          // Deliberately not the evaluation's photos. Those were taken weeks
          // ago; the point of these is documenting the ground as the crew
          // found it this morning.
          passed: facts.preworkPhotos > 0,
          blocking: true,
          source: "Job photos taken at the start of the work, not at the evaluation",
          reason: "Photograph the site as you found it, on the Field tab, before starting.",
        },
        {
          key: "crew",
          label: "Crew assigned",
          applies: true,
          passed: facts.crewAssigned,
          blocking: true,
          source: "The job's crew",
          reason: "Nobody is assigned to this job.",
        },
      ];

    case "closeout":
      // Field work only. Nothing about money: the landscaping being finished
      // and the bill being paid are different facts about different people.
      return [
        {
          key: "after-photos",
          label: "After photos taken",
          applies: true,
          passed: facts.afterPhotos > 0,
          blocking: true,
          source: "Job photos marked 'after'",
          reason: "Take the after photos on the Field tab.",
        },
        {
          key: "walkthrough",
          label: "Client walkthrough done",
          applies: true,
          passed: facts.walkthroughDone,
          blocking: false,
          source: "The job's walkthrough record",
          reason: "No walkthrough recorded. Note the exception if the client was not there.",
        },
      ];

    case "completed":
      // The work is finished and billed. An unpaid balance does not hold this
      // shut -- the landscaping really is done -- it keeps the job in Needs
      // attention until it is settled or somebody records what happens about
      // it. See attentionReasons.
      return [
        {
          key: "after-photos",
          label: "After photos taken",
          applies: true,
          passed: facts.afterPhotos > 0,
          blocking: true,
          source: "Job photos marked 'after'",
          reason: "Take the after photos on the Field tab.",
        },
        {
          key: "invoice",
          label: "Invoice raised",
          applies: true,
          passed: facts.invoiceRaised,
          blocking: true,
          source: "The job's invoice",
          reason: "Raise the invoice on the Billing tab.",
        },
        {
          key: "walkthrough",
          label: "Client walkthrough done, or the exception noted",
          applies: true,
          passed: facts.walkthroughDone,
          blocking: false,
          source: "The job's walkthrough record",
          reason: "No walkthrough recorded.",
        },
      ];
  }
}

function money(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/** Which gates come before this one, so a later gate carries the earlier ones. */
export function gatesUpTo(gate: GateKey): GateKey[] {
  const end = GATE_ORDER.indexOf(gate);
  return GATE_ORDER.slice(0, end + 1);
}

/**
 * One gate, judged.
 *
 * A check the job does not need is dropped rather than shown passing: a bush
 * trim's readiness should not read "measurements taken ✓" when nothing was
 * measured. An override never turns a cross into a tick; it sits beside the
 * failed check and stops it stopping the job.
 */
export function evaluateGate(
  gate: GateKey,
  facts: JobFacts,
  issues: readonly Issue[] = [],
  overrides: readonly GateOverride[] = []
): GateResult {
  const byCheck = new Map(overrides.map((o) => [o.checkKey, o]));

  const checks: CheckResult[] = checksFor(gate, facts)
    .filter((check) => check.applies)
    .map((check) => {
      const override = byCheck.get(check.key) ?? null;
      const stopping = !check.passed && check.blocking && override == null;
      const state: CheckState = check.passed
        ? "passed"
        : override != null
          ? "overridden"
          : check.blocking
            ? "failed"
            : "warning";
      return { ...check, override, stopping, state };
    });

  const held = blockingStage(issues, gate as BlockingStage);
  const stoppers = checks.filter((check) => check.stopping);
  const warnings = checks.filter((check) => check.state === "warning");

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
 * Sold work, scheduled, with every applicable blocking pre-start check passed
 * or formally overridden, every required confirmation actually made, and no
 * blocking issue open against the Ready stage. Nothing is stored: ask again
 * after somebody confirms the mulch and the answer changes on its own.
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

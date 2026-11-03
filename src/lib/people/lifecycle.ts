/**
 * The employee lifecycle. Pure, so the rules for who can move and why are
 * tested without a database. Nobody moves because time passed: a person moves
 * when the requirements of their stage are met.
 */

export const STAGE_KEYS = [
  "application", "screening", "interview", "job_offer", "onboarding", "training",
  "evaluation", "deployment", "performance_management", "advancement", "offboarding",
] as const;
export type PersonStage = (typeof STAGE_KEYS)[number];
export type PersonStatus = "active" | "declined" | "withdrawn" | "offboarded";

export const STAGE_LABEL: Record<PersonStage, string> = {
  application: "Application",
  screening: "Screening",
  interview: "Interview",
  job_offer: "Job Offer",
  onboarding: "Onboarding",
  training: "Training",
  evaluation: "Evaluation",
  deployment: "Deployment",
  performance_management: "Performance Management",
  advancement: "Advancement",
  offboarding: "Offboarding",
};

export const STAGE_OWNER: Record<PersonStage, string> = {
  application: "Account Manager",
  screening: "Account Manager",
  interview: "Account Manager",
  job_offer: "Account Manager",
  onboarding: "Account Manager",
  training: "Project Lead",
  evaluation: "Project Lead",
  deployment: "Project Lead",
  performance_management: "Project Lead",
  advancement: "Account Manager",
  offboarding: "Account Manager",
};

export function isPersonStage(value: string): value is PersonStage {
  return (STAGE_KEYS as readonly string[]).includes(value);
}

export const ROLE_PATH = ["affiliate", "evaluator", "project-technician", "project-lead", "account-manager"] as const;

export const ROLE_LABEL: Record<(typeof ROLE_PATH)[number], string> = {
  affiliate: "Affiliate",
  evaluator: "Evaluator",
  "project-technician": "Project Technician",
  "project-lead": "Project Lead",
  "account-manager": "Account Manager",
};

export const INTERVIEW_CRITERIA = [
  "Relevant experience",
  "Technical knowledge",
  "Communication",
  "Reliability",
  "Problem-solving",
  "Availability",
  "Understanding of expectations",
  "Willingness to follow procedures",
] as const;

export const INTERVIEW_OUTCOME = { advance: "Advance", additional_interview: "Additional Interview Required", decline: "Decline" } as const;
export type InterviewOutcome = keyof typeof INTERVIEW_OUTCOME;

export const EVALUATION_OUTCOME = { pass: "Pass", needs_improvement: "Needs Improvement", fail: "Fail" } as const;
export type EvaluationOutcome = keyof typeof EVALUATION_OUTCOME;

export const ONBOARDING_PARTS = { compliance: "Compliance", clarity: "Clarity", culture: "Culture", connection: "Connection", check_back: "Check-Back" } as const;

export const PERFORMANCE_KINDS = {
  quality: "Work quality",
  completion: "Project completion",
  productivity: "Productivity",
  attendance: "Attendance and reliability",
  safety: "Safety",
  communication: "Communication",
  customer: "Customer feedback",
  callback: "Callback or corrective work",
  procedures: "Compliance with procedures",
  feedback: "Feedback given",
  retraining: "Retraining",
  review: "Performance review",
} as const;
export type PerformanceKind = keyof typeof PERFORMANCE_KINDS;

/** The application stage in Hiring that matches a place on the lifecycle. */
export function lifecycleForApplicant(stage: string): { stage: PersonStage; status: PersonStatus } {
  switch (stage) {
    case "screened_out":
      return { stage: "screening", status: "declined" };
    case "needs_review":
    case "video_requested":
    case "video_submitted":
      return { stage: "screening", status: "active" };
    case "interview":
      return { stage: "interview", status: "active" };
    case "offer":
      return { stage: "job_offer", status: "active" };
    case "hired":
      return { stage: "onboarding", status: "active" };
    case "not_a_fit":
      return { stage: "interview", status: "declined" };
    case "withdrawn":
      return { stage: "screening", status: "withdrawn" };
    default:
      return { stage: "application", status: "active" };
  }
}

export interface ItemLike {
  label: string;
  required: boolean;
  done_at: string | null;
  stage: string;
  due_on?: string | null;
}
export interface AssignmentLike {
  title: string;
  required: boolean;
  shown_at: string | null;
  showed_back_at: string | null;
  taught_at: string | null;
  read_at: string | null;
  competency_key: string;
}
export interface MoveFacts {
  stage: PersonStage;
  status: PersonStatus;
  hasProfile: boolean;
  items: readonly ItemLike[];
  assignments: readonly AssignmentLike[];
  /** Competency keys verified and not revoked. */
  competencies: readonly string[];
}

const STAGES_MOVED_BY_HIRING: readonly PersonStage[] = ["application", "screening", "interview", "job_offer"];

/** What still stands in the way of the next stage. Empty means they can move. */
export function missingForNext(facts: MoveFacts): string[] {
  if (facts.status !== "active") return ["This record is closed."];
  const open = facts.items.filter((i) => i.stage === facts.stage && i.required && !i.done_at).map((i) => i.label);
  if (facts.stage === "training") {
    for (const a of facts.assignments.filter((x) => x.required)) {
      if (!a.read_at) open.push(`${a.title}: read the written training`);
      if (!a.shown_at) open.push(`${a.title}: show them`);
      if (!a.showed_back_at) open.push(`${a.title}: they show us`);
      if (!a.taught_at) open.push(`${a.title}: they can teach it`);
    }
  }
  if (facts.stage === "evaluation") {
    for (const a of facts.assignments.filter((x) => x.required)) {
      if (!facts.competencies.includes(a.competency_key)) open.push(`${a.title}: pass the evaluation`);
    }
  }
  if ((facts.stage === "deployment" || facts.stage === "onboarding") && !facts.hasProfile) open.push("App account linked");
  return open;
}

/** Where someone goes next, or null when the next move belongs to Hiring or is a decision. */
export function nextStage(stage: PersonStage): PersonStage | null {
  if (STAGES_MOVED_BY_HIRING.includes(stage)) return null;
  switch (stage) {
    case "onboarding":
      return "training";
    case "training":
      return "evaluation";
    case "evaluation":
      return "deployment";
    case "deployment":
      return "performance_management";
    case "advancement":
      return "performance_management";
    default:
      return null;
  }
}

export type Eligibility = { level: "unsupervised" | "supervised" | "none"; reason: string };

/** Whether a person can be put on a job, and how. Competency is checked by a person, on observed work. */
export function assignmentEligibility(stage: PersonStage, status: PersonStatus): Eligibility {
  if (status !== "active") return { level: "none", reason: "They aren't active on the team." };
  if (STAGES_MOVED_BY_HIRING.includes(stage)) return { level: "none", reason: "They haven't been hired yet." };
  if (stage === "onboarding") return { level: "none", reason: "They need to finish onboarding first." };
  if (stage === "offboarding") return { level: "none", reason: "They are being offboarded." };
  if (stage === "training" || stage === "evaluation") return { level: "supervised", reason: "They can work only alongside a cleared lead until they pass their evaluation." };
  return { level: "unsupervised", reason: "They have completed training and evaluation." };
}

/** The one thing to do next, in plain words. */
export function nextAction(facts: MoveFacts): string {
  if (facts.status === "offboarded") return "Offboarded. Nothing left to do.";
  if (facts.status !== "active") return "Closed. Reopen from Hiring if this changes.";
  switch (facts.stage) {
    case "application":
    case "screening":
      return "Review the application in Hiring.";
    case "interview":
      return "Complete the interview scorecard.";
    case "job_offer":
      return "Prepare the offer and record their answer.";
    case "performance_management":
      return "Keep the performance record current.";
    default: {
      const gap = missingForNext(facts);
      if (gap.length === 0) {
        const to = nextStage(facts.stage);
        return to ? `Ready to move to ${STAGE_LABEL[to]}.` : "No open requirements.";
      }
      return gap[0];
    }
  }
}

const DAY = 86_400_000;

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Saturdays and Sundays do not count. Holidays are not modelled. */
export function addBusinessDays(iso: string, days: number): string {
  let d = new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`));
  let left = days;
  while (left > 0) {
    d = new Date(d.getTime() + DAY);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

export interface TemplateLike {
  stage: string;
  item_key: string;
  part: string | null;
  label: string;
  required: boolean;
  legal: boolean;
  positions: readonly string[];
  applies_to: "any" | "employee" | "contractor";
  due_days: number | null;
  due_business_days: number | null;
  sort: number;
  active: boolean;
}

/** One person's items for a stage. An undetermined classification gets every worker form until it is decided. */
export function itemsForPerson<T extends TemplateLike>(
  templates: readonly T[],
  person: { stage: PersonStage; position: string | null; classification: string },
  startDate: string
): (T & { due_on: string | null })[] {
  return templates
    .filter(
      (t) =>
        t.active &&
        t.stage === person.stage &&
        (t.positions.length === 0 || (person.position ? t.positions.includes(person.position) : false)) &&
        (t.applies_to === "any" || person.classification === "undetermined" || t.applies_to === person.classification)
    )
    .map((t) => ({
      ...t,
      due_on:
        t.due_business_days != null
          ? addBusinessDays(startDate, t.due_business_days)
          : t.due_days != null
            ? addDays(startDate, t.due_days)
            : null,
    }));
}

/** Lines typed into a box, one per line. */
export function lines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

export interface DashboardPerson {
  stage: PersonStage;
  status: PersonStatus;
  applicantStage?: string | null;
  overdue: number;
  openEvaluation: boolean;
  needsAttention: boolean;
}

export interface DashboardCounts {
  newApplicants: number;
  awaitingScreening: number;
  interviewsPending: number;
  offersPending: number;
  awaitingOnboarding: number;
  inTraining: number;
  evaluationsPending: number;
  readyForDeployment: number;
  requiringAttention: number;
}

export function dashboardCounts(people: readonly DashboardPerson[]): DashboardCounts {
  const active = people.filter((p) => p.status === "active");
  return {
    newApplicants: active.filter((p) => p.stage === "application" || p.applicantStage === "video_requested").length,
    awaitingScreening: active.filter((p) => p.applicantStage === "needs_review" || p.applicantStage === "video_submitted").length,
    interviewsPending: active.filter((p) => p.stage === "interview").length,
    offersPending: active.filter((p) => p.stage === "job_offer").length,
    awaitingOnboarding: active.filter((p) => p.stage === "onboarding").length,
    inTraining: active.filter((p) => p.stage === "training").length,
    evaluationsPending: active.filter((p) => p.stage === "evaluation").length,
    readyForDeployment: active.filter((p) => p.stage === "deployment").length,
    requiringAttention: active.filter((p) => p.needsAttention).length,
  };
}

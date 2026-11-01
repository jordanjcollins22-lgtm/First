/**
 * The career ladder: 21 stages in three tiers, from Jordan (2026-11-01).
 *
 * Promotions are earned on clear metrics, never on tenure. So a stage is
 * signed off by somebody else once its requirement is met, and the stages are
 * climbed in order: the next stage is always the lowest one not yet signed off.
 *
 * A stage with a `target` has a number to reach first (five reviews, two
 * morning meetings, three new hires mentored). Its count is kept on the
 * tracker and the sign-off unlocks when the count reaches the target.
 */

export type TierKey = "technician" | "general_manager" | "owner";

export interface Tier {
  key: TierKey;
  label: string;
  /** First and last stage number in the tier. */
  first: number;
  last: number;
  blurb: string;
}

export interface StageTarget {
  count: number;
  /** Plural noun for what is being counted, e.g. "reviews". */
  unit: string;
}

export interface Stage {
  number: number;
  tier: TierKey;
  title: string;
  requirement: string;
  target?: StageTarget;
}

export const TIERS: readonly Tier[] = [
  {
    key: "technician",
    label: "Technician",
    first: 1,
    last: 7,
    blurb: "Frontline team members move up on clear metrics. Nothing is handed out for tenure.",
  },
  {
    key: "general_manager",
    label: "General Manager",
    first: 8,
    last: 14,
    blurb: "Running the business without needing the field tools.",
  },
  {
    key: "owner",
    label: "Owner",
    first: 15,
    last: 21,
    blurb: "Out of the daily management grind and into owning the asset.",
  },
];

export const STAGES: readonly Stage[] = [
  {
    number: 1,
    tier: "technician",
    title: "Infield Training Completion",
    requirement: "Finish every onboarding module and the field checkouts with a certified trainer.",
  },
  {
    number: 2,
    tier: "technician",
    title: "P4P Mastery",
    requirement: "Hit or beat the Pay for Performance production benchmarks for two pay periods in a row.",
    target: { count: 2, unit: "pay periods in a row" },
  },
  {
    number: 3,
    tier: "technician",
    title: "Customer Satisfaction Champion",
    requirement: "Five positive online reviews (Google, Yelp, Facebook) where the client names them.",
    target: { count: 5, unit: "reviews naming them" },
  },
  {
    number: 4,
    tier: "technician",
    title: "Public Communication",
    requirement: "Volunteer to prepare and lead at least two morning team meetings.",
    target: { count: 2, unit: "morning meetings led" },
  },
  {
    number: 5,
    tier: "technician",
    title: "Certified Field Trainer",
    requirement: "Teach and certify new hires out on the trucks.",
  },
  {
    number: 6,
    tier: "technician",
    title: "Financial Competency",
    requirement: "Keep performance up long enough to qualify for and earn two profit-sharing checks.",
    target: { count: 2, unit: "profit-sharing checks" },
  },
  {
    number: 7,
    tier: "technician",
    title: "The Master Mentor",
    requirement: "Guide three separate new hires through Stages 1 to 4 of their own playbooks.",
    target: { count: 3, unit: "new hires through Stage 4" },
  },
  {
    number: 8,
    tier: "general_manager",
    title: "Getting Off the Tools",
    requirement: "Move from manual labor to route logistics and truck coordination.",
  },
  {
    number: 9,
    tier: "general_manager",
    title: "Route Density & Scheduling",
    requirement: "Master regional logistics, routing software and scheduling to cut travel time.",
  },
  {
    number: 10,
    tier: "general_manager",
    title: "Client Acquisition & Estimating",
    requirement: "Run residential and commercial bids, track close rates, and run local ad platforms.",
  },
  {
    number: 11,
    tier: "general_manager",
    title: "Team Accountability",
    requirement: "Hire, run quarterly reviews, track labor metrics, and turn around low performers.",
  },
  {
    number: 12,
    tier: "general_manager",
    title: "Open-Book Management Literacy",
    requirement: "Read the P&L fully, budget hours, and control overhead.",
  },
  {
    number: 13,
    tier: "general_manager",
    title: "Full Location Autonomy",
    requirement: "Hit the operating benchmarks so the location runs profitably without the owner there.",
  },
  {
    number: 14,
    tier: "general_manager",
    title: "The 4 Quarters Distribution",
    requirement: "Keep the operation profitable for four business quarters in a row, winter included.",
    target: { count: 4, unit: "profitable quarters in a row" },
  },
  {
    number: 15,
    tier: "owner",
    title: "The $500,000 Revenue Threshold",
    requirement: "Grow capacity past $500,000 in annual labor revenue.",
  },
  {
    number: 16,
    tier: "owner",
    title: "Capital Liquidity Benchmarking",
    requirement: "Hold a cash reserve of at least one full month of operating revenue.",
  },
  {
    number: 17,
    tier: "owner",
    title: "Infrastructure Decoupling",
    requirement: "Build a second tier of management (CSRs, field supervisors) so the owner no longer answers operational questions.",
  },
  {
    number: 18,
    tier: "owner",
    title: "Multi-Crew / Multi-Truck Scaling",
    requirement: "Grow past local market saturation by making the most of the trucks.",
  },
  {
    number: 19,
    tier: "owner",
    title: "The $1,000,000 Millennial Level",
    requirement: "Pass $1 million in system-wide revenue while keeping net margin in double digits.",
  },
  {
    number: 20,
    tier: "owner",
    title: "Multi-Unit Expansion",
    requirement: "Open a second location or a separate business line, funded by the first one's cash flow.",
  },
  {
    number: 21,
    tier: "owner",
    title: "The Wealth Creator",
    requirement: "The business is a hands-off asset that funds a wider passive investment portfolio.",
  },
];

export const STAGE_COUNT = STAGES.length;

export function stageByNumber(n: number): Stage | null {
  return STAGES[n - 1] ?? null;
}

export function tierFor(key: TierKey): Tier {
  return TIERS.find((t) => t.key === key)!;
}

export function stagesInTier(key: TierKey): Stage[] {
  return STAGES.filter((s) => s.tier === key);
}

/** One saved row of somebody's progress on one stage. */
export interface StageProgress {
  stage: number;
  count: number;
  note: string | null;
  completed_at: string | null;
  completed_by: string | null;
}

export type StageStatus = "done" | "current" | "locked";

export interface CareerSummary {
  /** How many stages are signed off, counted from Stage 1 without a gap. */
  completed: number;
  /** The stage they are working on, or null once all 21 are done. */
  current: Stage | null;
  /** The tier they are in: the current stage's, or Owner when finished. */
  tier: Tier;
  /** Count toward the current stage's target. */
  currentCount: number;
}

/**
 * Where somebody is on the ladder.
 *
 * Climbed in order, so a stray sign-off further up (say an old row left from
 * before a stage was reopened) never skips anybody ahead.
 */
export function summarize(progress: readonly StageProgress[]): CareerSummary {
  const byStage = new Map(progress.map((p) => [p.stage, p]));
  let completed = 0;
  while (completed < STAGE_COUNT && byStage.get(completed + 1)?.completed_at) completed++;
  const current = stageByNumber(completed + 1);
  return {
    completed,
    current,
    tier: tierFor(current?.tier ?? "owner"),
    currentCount: current ? (byStage.get(current.number)?.count ?? 0) : 0,
  };
}

export function statusOf(stage: number, summary: CareerSummary): StageStatus {
  if (stage <= summary.completed) return "done";
  if (stage === summary.completed + 1) return "current";
  return "locked";
}

/** Whether the stage's number (if it has one) has been reached. */
export function targetMet(stage: Stage, count: number): boolean {
  return !stage.target || count >= stage.target.count;
}

/** Why a stage can't be signed off right now, or null when it can. */
export function signOffBlocker(stageNumber: number, progress: readonly StageProgress[]): string | null {
  const stage = stageByNumber(stageNumber);
  if (!stage) return "That stage doesn't exist.";
  const summary = summarize(progress);
  if (stageNumber <= summary.completed) return "That stage is already signed off.";
  if (stageNumber !== summary.completed + 1) return `Stage ${summary.completed + 1} comes first.`;
  const count = progress.find((p) => p.stage === stageNumber)?.count ?? 0;
  if (!targetMet(stage, count)) {
    return `Needs ${stage.target!.count} ${stage.target!.unit} first (${count} so far).`;
  }
  return null;
}

/** Only the most recent sign-off can be taken back, so the ladder stays unbroken. */
export function reopenBlocker(stageNumber: number, progress: readonly StageProgress[]): string | null {
  const { completed } = summarize(progress);
  if (stageNumber > completed) return "That stage isn't signed off.";
  if (stageNumber !== completed) return `Reopen Stage ${completed} first.`;
  return null;
}

export function parseStageNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= STAGE_COUNT ? n : null;
}

export function clampCount(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(999, Math.round(n)));
}

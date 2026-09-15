/**
 * One way to say something is wrong.
 *
 * Before this there was a callback panel, a dispute record, a completion note
 * and a message thread, and a material shortage was told to somebody rather
 * than written anywhere. Four systems for one idea, and no screen that could
 * answer "what is stuck".
 *
 * So there is one issue record. It hangs off the job, it says what kind of
 * problem it is and how bad, and -- the part that matters -- whether it blocks
 * the job from moving on. A blocking issue is not a status: the job stays
 * Upcoming or Active and appears in Needs attention as well, because "this job
 * has a material problem" and "this job is next Tuesday" are both true and the
 * old app could only hold one of them.
 */

export const ISSUE_TYPES = [
  "scope",
  "client_change",
  "scheduling",
  "weather",
  "material",
  "equipment",
  "crew",
  "access",
  "safety",
  "damage",
  "quality",
  "payment",
  "complaint",
  "other",
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

export const ISSUE_TYPE_LABEL: Record<IssueType, string> = {
  scope: "Scope",
  client_change: "Client change",
  scheduling: "Scheduling",
  weather: "Weather",
  material: "Material",
  equipment: "Equipment",
  crew: "Crew",
  access: "Access",
  safety: "Safety",
  damage: "Damage",
  quality: "Quality / callback",
  payment: "Payment",
  complaint: "Client complaint",
  other: "Other",
};

/**
 * How bad it is.
 *
 * Only the last two stop a job. "Warning" exists so that somebody can write
 * down a thing worth knowing without halting the work, which is what stops
 * people writing nothing at all.
 */
export const SEVERITIES = ["info", "warning", "blocking", "critical"] as const;
export type IssueSeverity = (typeof SEVERITIES)[number];

export const SEVERITY_LABEL: Record<IssueSeverity, string> = {
  info: "Note",
  warning: "Warning",
  blocking: "Blocking",
  critical: "Critical",
};

export const ISSUE_STATUSES = ["open", "resolved", "cancelled"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

/** The lifecycle stage an issue holds up, when it holds one up. */
export const BLOCKING_STAGES = ["proposal", "booking", "ready", "start", "closeout", "completed"] as const;
export type BlockingStage = (typeof BLOCKING_STAGES)[number];

export interface Issue {
  id: string;
  jobId: string;
  customerId: string | null;
  propertyId: string | null;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string | null;
  status: IssueStatus;
  /** Whose job it is to clear it. */
  ownerId: string | null;
  ownerName: string | null;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  dueAt: string | null;
  /**
   * Whether it stops the job. Set from the severity when an issue is raised,
   * and kept as its own field because a manager can decide a critical-looking
   * thing does not actually stop the work, or that a warning does.
   */
  blocking: boolean;
  /** Which gate it holds, when it holds one in particular. */
  blockingStage: BlockingStage | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
}

export function isIssueType(value: string): value is IssueType {
  return (ISSUE_TYPES as readonly string[]).includes(value);
}

export function isSeverity(value: string): value is IssueSeverity {
  return (SEVERITIES as readonly string[]).includes(value);
}

export function isBlockingStage(value: string): value is BlockingStage {
  return (BLOCKING_STAGES as readonly string[]).includes(value);
}

/**
 * Whether an issue of this severity stops the work by default.
 *
 * A note and a warning do not. This is only the default: `blocking` is stored
 * on the issue, so somebody who knows better can say otherwise, and the record
 * shows they did.
 */
export function blocksByDefault(severity: IssueSeverity): boolean {
  return severity === "blocking" || severity === "critical";
}

export function isOpen(issue: Pick<Issue, "status">): boolean {
  return issue.status === "open";
}

/** Open issues that stop the job. */
export function blockingIssues(issues: readonly Issue[]): Issue[] {
  return issues.filter((issue) => isOpen(issue) && issue.blocking);
}

/** Open issues that stop a particular gate — or any gate at all. */
export function blockingStage(issues: readonly Issue[], stage: BlockingStage): Issue[] {
  return blockingIssues(issues).filter((issue) => issue.blockingStage == null || issue.blockingStage === stage);
}

/**
 * Whether a job belongs in Needs attention.
 *
 * Derived, never stored. A job is there because something unresolved on it is
 * significant, and it leaves the moment that is resolved -- there is no status
 * for somebody to forget to change back.
 */
export function needsAttention(issues: readonly Issue[]): boolean {
  return issues.some((issue) => isOpen(issue) && (issue.blocking || issue.severity === "critical"));
}

const SEVERITY_RANK: Record<IssueSeverity, number> = { critical: 0, blocking: 1, warning: 2, info: 3 };

/** Worst first, then oldest: the thing to deal with is at the top. */
export function sortIssues(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    if (a.status !== b.status) return a.status === "open" ? -1 : 1;
    const rank = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (rank !== 0) return rank;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

/** The worst open severity on a job, for a badge. Null when nothing is open. */
export function worstOpen(issues: readonly Issue[]): IssueSeverity | null {
  const open = issues.filter(isOpen);
  if (open.length === 0) return null;
  return open.reduce<IssueSeverity>(
    (worst, issue) => (SEVERITY_RANK[issue.severity] < SEVERITY_RANK[worst] ? issue.severity : worst),
    "info"
  );
}

/** A sentence for the top of a job: what is open, and how bad. */
export function summarise(issues: readonly Issue[]): string | null {
  const open = issues.filter(isOpen);
  if (open.length === 0) return null;
  const stopping = open.filter((issue) => issue.blocking).length;
  const rest = open.length - stopping;
  if (stopping === 0) return `${rest} open ${rest === 1 ? "issue" : "issues"}, none of them stopping the work.`;
  const tail = rest > 0 ? `, and ${rest} other open ${rest === 1 ? "issue" : "issues"}` : "";
  return `${stopping} ${stopping === 1 ? "issue is" : "issues are"} stopping this job${tail}.`;
}

/**
 * What a client sees of their own work, and nothing of anybody else's.
 *
 * Clients had no way back in. Everything we sent them was a link with a token
 * in it — a proposal, a progress page — so coming back a fortnight later meant
 * finding the right email, and "can you resend it" was a phone call the office
 * took over and over.
 *
 * Now they have an account. It is deliberately the thinnest kind of account
 * there is: an email address and a code that arrives when they ask for one.
 * No password to forget, none to reuse from somewhere else, and nothing worth
 * stealing if it leaks — a code is good once and for a few minutes.
 *
 * The one rule this file exists to keep: a client account is not a staff
 * account. It carries no profile and no role, so every guard in the app turns
 * it away, and what it can read is scoped to one customer record. That is
 * enforced in the data layer; what is here is the shaping and the wording.
 */

export type ProjectStage =
  | "evaluation_booked"
  | "quoted"
  | "accepted"
  | "scheduled"
  | "in_progress"
  | "finished"
  | "cancelled";

export interface ClientProject {
  jobId: string;
  address: string;
  stage: ProjectStage;
  /** The evaluation, if one is booked and still ahead. */
  evaluationAt: string | null;
  /** Whether the evaluation is a visit or a video call. */
  digital: boolean;
  /** Their proposal, when there is one to look at. */
  proposalToken: string | null;
  proposalStatus: string | null;
  totalCost: number | null;
  /** What is still owed, in cents, when anything is. */
  outstandingCents: number;
  /** The progress link we already generate for their people. */
  progressToken: string | null;
  updatedAt: string;
}

/** What the client is told the project is doing, in their words not ours. */
export function stageLabel(stage: ProjectStage): string {
  switch (stage) {
    case "evaluation_booked":
      return "Evaluation booked";
    case "quoted":
      return "Quote ready";
    case "accepted":
      return "Booked in";
    case "scheduled":
      return "Scheduled";
    case "in_progress":
      return "Work underway";
    case "finished":
      return "Finished";
    case "cancelled":
      return "Cancelled";
  }
}

/**
 * The one thing worth doing next, said to the client.
 *
 * A project page that lists facts leaves somebody wondering whether it is
 * their move. This says so.
 */
export function nextStepFor(project: ClientProject): string | null {
  if (project.stage === "cancelled") return null;
  if (project.stage === "quoted" && project.proposalToken) return "Have a look at your quote.";
  if (project.outstandingCents > 0 && project.stage !== "evaluation_booked") {
    return "There is a balance left to pay.";
  }
  if (project.stage === "evaluation_booked") {
    return project.digital
      ? "We will call you for the walkthrough."
      : "We will come out and take a look.";
  }
  if (project.stage === "finished") return null;
  return null;
}

/**
 * Newest activity first.
 *
 * A client with three projects wants the live one at the top, and "live" is
 * better approximated by what changed most recently than by which stage it is
 * in — a job finished yesterday is more interesting than one quoted in March.
 */
export function orderProjects(projects: ClientProject[]): ClientProject[] {
  const rank: Record<ProjectStage, number> = {
    in_progress: 0,
    scheduled: 1,
    accepted: 2,
    quoted: 3,
    evaluation_booked: 4,
    finished: 5,
    cancelled: 6,
  };
  return [...projects].sort(
    (a, b) =>
      rank[a.stage] - rank[b.stage] ||
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Whether an email is worth sending a code to.
 *
 * Deliberately loose. This only decides whether to bother the mail server, and
 * refusing a real address because it has an unusual shape is worse than
 * sending one email that bounces.
 */
export function looksLikeEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 3 && trimmed.length < 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/** Digits only, and the length Supabase sends. */
export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 6);
}

export function codeLooksComplete(raw: string): boolean {
  return cleanCode(raw).length === 6;
}

/**
 * What to say when a code will not work.
 *
 * Never says whether the address has an account. Somebody typing addresses
 * into this box to find out who is a client of ours should learn nothing, and
 * the honest message is the same either way: if that address is one of ours,
 * a code is on its way.
 */
export function sentMessage(email: string): string {
  const at = email.trim();
  return `If ${at} is on one of our jobs, a six-digit code is on its way. It lasts about an hour.`;
}

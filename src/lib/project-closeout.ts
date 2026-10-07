/**
 * A project on one screen: where it got to and when, and what closing it
 * still needs.
 *
 * The timeline answers the questions somebody opens a project to ask. Did
 * they book, when was the evaluation, is the site map in, did the proposal
 * go, did they sign, is it on the calendar, when did the crew get there.
 * Each with its date, or not yet.
 *
 * Closing follows one order. The account manager walks the finished job in
 * person, takes the final afters, and sends the client the befores and
 * afters. The client approves them from their phone. Then the manager
 * approves, and only then is the job signed off. A job is done when the
 * client is happy, not when the crew packs up.
 *
 * Pure, so the order is tested without a database.
 */

export interface Milestone {
  key: string;
  label: string;
  done: boolean;
  /** When it happened, or when it is booked for. */
  at: string | null;
  /** Booked, not happened yet: an evaluation or a start date in the future. */
  upcoming?: boolean;
  /** A word more, when the date alone does not say it. */
  detail?: string | null;
}

export interface TimelineInput {
  evaluationDate: string | null;
  evaluationStatus: string;
  evaluationSubmittedAt: string | null;
  proposal: { status: string; sentAt: string | null; respondedAt: string | null } | null;
  jobStatus: string;
  projectStartDate: string | null;
  /** The first day of the first visit that was not cancelled. */
  firstVisitOn: string | null;
  /** When the crew first tapped Arrived, or clocked in, on this job. */
  crewArrivedAt: string | null;
  review: ClientReviewState | null;
  photosApprovedAt: string | null;
  completedAt: string | null;
  now: Date;
}

const SIGNED_STATUSES = new Set(["approved", "in_progress", "completed"]);

export function projectTimeline(input: TimelineInput): Milestone[] {
  const past = (at: string | null) => Boolean(at && new Date(at).getTime() <= input.now.getTime());
  const evaluated = input.evaluationStatus === "completed" || Boolean(input.evaluationSubmittedAt);
  const proposal = input.proposal;
  // "sent" is the status from the moment it is approved here; sent_at is when
  // it actually reached them.
  const sent = Boolean(proposal?.sentAt) || proposal?.status === "accepted" || proposal?.status === "declined";
  const signed = proposal?.status === "accepted" || SIGNED_STATUSES.has(input.jobStatus);
  const startOn = input.projectStartDate ?? input.firstVisitOn;
  const clientApproved = input.review?.status === "approved";
  const signedOff = input.jobStatus === "completed" && Boolean(input.photosApprovedAt);

  return [
    {
      key: "booked",
      label: "Evaluation booked",
      done: Boolean(input.evaluationDate),
      at: input.evaluationDate,
      upcoming: Boolean(input.evaluationDate) && !evaluated && !past(input.evaluationDate),
    },
    {
      key: "evaluated",
      label: "Evaluation done",
      done: evaluated,
      at: evaluated ? input.evaluationDate : null,
    },
    {
      key: "site-map",
      label: "Site map submitted",
      done: evaluated,
      at: input.evaluationSubmittedAt,
    },
    {
      key: "proposal-sent",
      label: "Proposal sent",
      done: sent,
      at: proposal?.sentAt ?? null,
      detail: proposal && !sent ? "Built, not sent" : null,
    },
    {
      key: "signed",
      label: proposal?.status === "declined" ? "Declined" : "Signed",
      done: signed,
      at: proposal?.status === "accepted" || proposal?.status === "declined" ? proposal.respondedAt : null,
    },
    {
      key: "scheduled",
      label: "Job scheduled",
      done: Boolean(startOn),
      at: startOn,
      upcoming: Boolean(startOn) && !input.crewArrivedAt && !past(startOn),
    },
    {
      key: "crew-arrived",
      label: "Crew arrived",
      done: Boolean(input.crewArrivedAt),
      at: input.crewArrivedAt,
    },
    {
      key: "client-approved",
      label: "Client approved the before & afters",
      done: clientApproved,
      at: clientApproved ? input.review!.respondedAt : null,
      detail: input.review?.status === "changes" ? "Asked for changes" : input.review?.status === "sent" ? "Sent, waiting on them" : null,
    },
    {
      key: "signed-off",
      label: "Signed off",
      done: signedOff,
      at: signedOff ? input.completedAt : null,
    },
  ];
}

/** The newest time the before and afters went to the client, and what came back. */
export interface ClientReviewState {
  status: "sent" | "approved" | "changes";
  sentAt: string;
  respondedAt: string | null;
  clientNote: string | null;
  /** Approved face to face, recorded by somebody here, rather than from the link. */
  inPerson: boolean;
}

export interface CloseoutInput {
  /** The work is under way or done: before that there is nothing to close. */
  started: boolean;
  walkthrough: { ok: boolean; reason?: string };
  /** Every area has its after, or somebody said there is none to take. */
  aftersComplete: boolean;
  aftersMissing: string[];
  review: ClientReviewState | null;
  /** Touch-ups the manager marked on the afters and nobody has cleared. */
  openMarks: number;
  photosApprovedAt: string | null;
  jobStatus: string;
}

export interface CloseoutStep {
  key: "walk" | "afters" | "send" | "client" | "approve";
  label: string;
  done: boolean;
  /** Why it is not done, or what to do next. */
  note: string | null;
}

/** The five steps from finished work to a signed-off job, in the order they happen. */
export function closeoutSteps(input: CloseoutInput): CloseoutStep[] {
  const review = input.review;
  const signedOff = input.jobStatus === "completed" && Boolean(input.photosApprovedAt);
  return [
    {
      key: "walk",
      label: "Walk the job in person",
      done: input.walkthrough.ok,
      note: input.walkthrough.ok ? null : input.walkthrough.reason ?? null,
    },
    {
      key: "afters",
      label: "Take the final afters",
      done: input.aftersComplete,
      note: input.aftersComplete ? null : input.aftersMissing.length ? `Still to take: ${input.aftersMissing.join(", ")}` : null,
    },
    {
      key: "send",
      label: "Send the client the before & afters",
      done: review != null,
      note: review ? (review.inPerson ? "Shown to them in person." : null) : null,
    },
    {
      key: "client",
      label: "Client approves",
      done: review?.status === "approved",
      note:
        review?.status === "changes"
          ? `They asked for changes${review.clientNote ? `: "${review.clientNote}"` : "."} Fix it, retake the afters and send again.`
          : review?.status === "sent"
            ? "Waiting on them."
            : null,
    },
    {
      key: "approve",
      label: "You approve, and the job is signed off",
      done: signedOff,
      note: input.openMarks > 0 ? `${input.openMarks} touch-up${input.openMarks === 1 ? "" : "s"} still open.` : null,
    },
  ];
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Whether the before and afters can go to the client yet. */
export function canSendForApproval(input: CloseoutInput): Verdict {
  if (!input.started) return { ok: false, reason: "Not until the work has started." };
  if (!input.walkthrough.ok) return { ok: false, reason: input.walkthrough.reason ?? "Walk the job in person first." };
  if (!input.aftersComplete) {
    return { ok: false, reason: input.aftersMissing.length ? `Take the afters first: ${input.aftersMissing.join(", ")}.` : "Take the afters first." };
  }
  if (input.review?.status === "approved") return { ok: false, reason: "They have already approved them." };
  return { ok: true };
}

/**
 * Whether the job can be signed off. The client has to have approved the
 * before and afters; nothing the crew or the office does stands in for that.
 */
export function canSignOffProject(input: CloseoutInput): Verdict {
  if (input.jobStatus === "completed" && input.photosApprovedAt) return { ok: false, reason: "Already signed off." };
  const send = canSendForApproval({ ...input, review: null });
  if (!send.ok) return send;
  if (!input.review) return { ok: false, reason: "Send the client the before & afters first." };
  if (input.review.status === "changes") return { ok: false, reason: "The client asked for changes. Fix them and send the before & afters again." };
  if (input.review.status !== "approved") return { ok: false, reason: "Waiting on the client to approve the before & afters." };
  if (input.openMarks > 0) return { ok: false, reason: "There are touch-ups still open. Clear them first." };
  return { ok: true };
}

/** The gate the crew's own sign-off has to pass too: the client has approved. */
export function clientApprovalGate(review: ClientReviewState | null): Verdict {
  if (review?.status === "approved") return { ok: true };
  if (review?.status === "changes") return { ok: false, reason: "The client asked for changes to the before & afters. Fix them and send them again." };
  if (review?.status === "sent") return { ok: false, reason: "Waiting on the client to approve the before & afters." };
  return { ok: false, reason: "The client has to approve the before & afters first. The account manager sends them from the project." };
}

export interface PairPhoto {
  kind: string;
  zoneId: string | null;
  zoneName: string | null;
  url: string | null;
  createdAt: string;
}

export interface BeforeAfterPair {
  zoneId: string;
  zoneName: string;
  before: string | null;
  after: string | null;
}

/**
 * One before and one after for each area: the first before taken and the
 * last after, because the first before is the yard as it was and the last
 * after is the work as it was left.
 */
export function beforeAfterPairs(photos: PairPhoto[], zones: { id: string; name: string }[]): BeforeAfterPair[] {
  const sorted = [...photos].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return zones
    .map((zone) => {
      const mine = sorted.filter((p) => p.zoneId === zone.id && p.url);
      const before = mine.find((p) => p.kind === "before")?.url ?? null;
      const after = [...mine].reverse().find((p) => p.kind === "after")?.url ?? null;
      return { zoneId: zone.id, zoneName: zone.name, before, after };
    })
    .filter((pair) => pair.before || pair.after);
}

/** The areas with no after yet, by name. */
export function aftersMissing(photos: { kind: string; zoneId: string | null }[], zones: { id: string; name: string }[], waivedAfter: Set<string>): string[] {
  return zones
    .filter((zone) => !waivedAfter.has(zone.id) && !photos.some((p) => p.kind === "after" && p.zoneId === zone.id))
    .map((zone) => zone.name);
}

/** The email that carries the link. Short: the photos do the talking. */
export function beforeAfterEmail(input: {
  clientName: string | null;
  businessName: string;
  link: string;
  signedBy: string | null;
}): { subject: string; text: string } {
  const first = (input.clientName ?? "").trim().split(/\s+/)[0];
  return {
    subject: "Your project is finished: the before and after",
    text: [
      `Hi ${first || "there"},`,
      "",
      "Your project is finished. Here are the befores and afters, area by area:",
      "",
      input.link,
      "",
      "If you are happy with it, tap Approve. If anything is not right, tell us on the same page and we will come back and fix it.",
      "",
      "Thank you,",
      input.signedBy || input.businessName,
      input.signedBy ? input.businessName : null,
    ]
      .filter((line) => line !== null)
      .join("\n"),
  };
}

/** Where the client opens it. */
export function clientReviewPath(token: string): string {
  return `/done/${token}`;
}

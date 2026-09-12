/**
 * What the work tells the marketing.
 *
 * A job going through its life is the best marketing signal the business has,
 * and none of it was reaching the map. An evaluation booked on Chestnut Drive
 * means a van is going to be parked on Chestnut Drive; a job finishing there
 * means there is a finished garden to photograph and forty neighbours who can
 * see it. Those are opportunities, and they were being noticed by whoever
 * happened to remember.
 *
 * Three rules, and they are the whole design.
 *
 * **Nothing here can stop the work.** A marketing failure must never fail a
 * booking, a schedule, a start or a closeout. Every one of these is recorded
 * after the operational write has already succeeded, and a failure is swallowed
 * and logged. A business that cannot book a job because a campaign row would
 * not insert is a worse business than one with no campaigns.
 *
 * **The same event twice is the same opportunity.** Retries happen, webhooks
 * arrive twice, somebody reschedules a job four times in a morning. One
 * opportunity per job, kind and window, enforced in the database rather than
 * by remembering to check -- so five deliveries make one row and update it,
 * and nobody prints five hundred door hangers.
 *
 * **Nothing is printed or sent by this.** An opportunity is a thing somebody
 * can look at and decide about. The whole marketing system already requires a
 * human approval before a zone is walked, and that stays true: this puts the
 * opportunity in front of them, it does not act on it.
 */

export const MARKETING_EVENTS = [
  "evaluation_booked",
  "job_scheduled",
  "job_started",
  "job_completed",
] as const;

export type MarketingEventKind = (typeof MARKETING_EVENTS)[number];

export const EVENT_LABEL: Record<MarketingEventKind, string> = {
  evaluation_booked: "Evaluation booked nearby",
  job_scheduled: "Job coming up nearby",
  job_started: "Work happening nearby",
  job_completed: "Finished job nearby",
};

/** What each event is worth doing something about. */
export const EVENT_MEANS: Record<MarketingEventKind, string> = {
  evaluation_booked: "A van will be on this street. Worth hanging the neighbours while somebody is there.",
  job_scheduled: "Work is booked here. The street is worth a wave before it happens.",
  job_started: "A crew is on this street today. Nearby doors are cheap to do on the way out.",
  job_completed: "There is a finished garden here to photograph, a review to ask for, and neighbours who saw it.",
};

export interface MarketingEventInput {
  kind: MarketingEventKind;
  jobId: string;
  propertyId: string | null;
  customerId: string | null;
  /** The door-hanger zone the property falls in, when it is known. */
  zoneId: string | null;
  occurredAt: string;
  /** Where the work itself came from, so attribution is carried rather than invented. */
  source: string | null;
  detail?: Record<string, unknown>;
}

export function isMarketingEvent(value: string): value is MarketingEventKind {
  return (MARKETING_EVENTS as readonly string[]).includes(value);
}

/**
 * The window an event belongs to: the Monday of its week.
 *
 * Two evaluations on the same street on Tuesday and Thursday are one
 * opportunity, not two -- somebody is going there once. A job rescheduled
 * within the week updates the row it already made; moved into the next week it
 * makes a new one, which is right, because that is a different trip.
 */
export function windowStart(occurredAt: string): string {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return "1970-01-01";
  const day = date.getUTCDay();
  // Monday is the start; Sunday (0) belongs to the week that has just ended.
  const back = day === 0 ? 6 : day - 1;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - back));
  return monday.toISOString().slice(0, 10);
}

/**
 * The key two deliveries of one event share.
 *
 * The database enforces it as well, which is what makes this safe under a
 * retry: the second insert conflicts and updates rather than adding a row.
 */
export function idempotencyKey(input: Pick<MarketingEventInput, "kind" | "jobId" | "occurredAt">): string {
  return `${input.jobId}:${input.kind}:${windowStart(input.occurredAt)}`;
}

/**
 * Photos that may be used in marketing.
 *
 * Only what was taken to show the work: the before shots and the after shots.
 * A progress photo is usually half a job and a muddy lawn, and a photo taken
 * to document damage or an issue is never marketing material -- somebody would
 * have to deliberately mark it so, and there is no way to do that by accident
 * here.
 */
export function marketingEligiblePhotos<T extends { phase: string | null; marketingApproved?: boolean }>(
  photos: readonly T[]
): T[] {
  return photos.filter((photo) => {
    if (photo.marketingApproved) return true;
    if (photo.phase === "issue") return false;
    return photo.phase === "evaluation" || photo.phase === "prework" || photo.phase === "after";
  });
}

/** Whether there is a before-and-after pair worth making a post from. */
export function hasBeforeAfterPair<T extends { phase: string | null }>(photos: readonly T[]): boolean {
  const eligible = marketingEligiblePhotos(photos);
  const before = eligible.some((p) => p.phase === "evaluation" || p.phase === "prework");
  const after = eligible.some((p) => p.phase === "after");
  return before && after;
}

export interface CompletionWork {
  /** A before-and-after post can be made from what was photographed. */
  contentCandidate: boolean;
  /** The client can be asked for a review. */
  reviewRequest: boolean;
  /** The street is worth another wave now there is something to show. */
  neighbourhoodOpportunity: boolean;
}

/**
 * What finishing a job makes possible.
 *
 * Each one is only true when the thing it needs actually exists. A review
 * request needs somebody to ask; a content candidate needs a pair of photos.
 * Saying "post the before and after" about a job with no after photo is how a
 * to-do list becomes noise somebody stops reading.
 */
export function completionWork(input: {
  photos: readonly { phase: string | null; marketingApproved?: boolean }[];
  hasClientContact: boolean;
  zoneId: string | null;
}): CompletionWork {
  return {
    contentCandidate: hasBeforeAfterPair(input.photos),
    reviewRequest: input.hasClientContact,
    neighbourhoodOpportunity: input.zoneId != null,
  };
}

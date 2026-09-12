/**
 * What is still owed on a job, and the one thing to do about it now.
 *
 * The job page showed every panel it could and left somebody to work out
 * what was missing by opening each one. On a phone that is a lot of
 * scrolling to answer a question with a one-word answer: have the after
 * photos gone in yet.
 *
 * So the whole job is reduced to a list of things that are either submitted
 * or not, and the first unsubmitted one is what is due next. Derived from
 * what already exists rather than stored, like the stage and the pipeline
 * before it: a stored checklist is another thing to keep in step, and it
 * starts lying the first time somebody uploads a photo from a different
 * screen.
 */

import type { JobStage } from "@/lib/job-stage";

export interface OutstandingItem {
  id: string;
  /** What it is, in the words somebody would use out loud. */
  label: string;
  done: boolean;
  /**
   * Waiting on somebody outside the business. Still outstanding, but not
   * something anybody here can tick off, so it never becomes "due next".
   */
  waiting?: boolean;
}

export interface JobFacts {
  stage: JobStage;
  evaluationBooked: boolean;
  evaluationDone: boolean;
  /** Zones with a service on them, which is what makes a proposal possible. */
  zonesMeasured: number;
  proposalStatus: string | null;
  /** Days the client has been sitting on a sent proposal. */
  scheduled: boolean;
  visitsBooked: number;
  /** Zone names that need photographing, from the site map. */
  zoneNames: string[];
  /** Photo kinds present per zone name. */
  photosByZone: Record<string, string[]>;
  walkthroughRequested: boolean;
  walkthroughApproved: boolean;
  signedOff: boolean;
  invoiced: boolean;
}

/** The three stages every zone has to show before a job can be signed off. */
const PHOTO_STAGES = ["before", "during", "after"] as const;

const STAGE_WORDS: Record<(typeof PHOTO_STAGES)[number], string> = {
  before: "Before photos",
  during: "In-progress photos",
  after: "After photos",
};

/**
 * Which zones are still missing a given kind of photo.
 *
 * Named rather than counted. "2 zones missing after photos" sends somebody
 * hunting; "Front bed, Side path" sends them to the right part of the
 * property.
 */
export function zonesMissing(
  facts: Pick<JobFacts, "zoneNames" | "photosByZone">,
  kind: string
): string[] {
  return facts.zoneNames.filter((zone) => !(facts.photosByZone[zone] ?? []).includes(kind));
}

function photoLabel(
  facts: Pick<JobFacts, "zoneNames" | "photosByZone">,
  kind: (typeof PHOTO_STAGES)[number]
): string {
  const missing = zonesMissing(facts, kind);
  if (missing.length === 0) return STAGE_WORDS[kind];
  if (facts.zoneNames.length === 0) return STAGE_WORDS[kind];
  if (missing.length === facts.zoneNames.length) return `${STAGE_WORDS[kind]} for every zone`;
  return `${STAGE_WORDS[kind]}: ${missing.join(", ")}`;
}

/**
 * Everything the job still owes, in the order it is owed.
 *
 * Cancelled jobs owe nothing. Neither do the parts of a job that are behind
 * the stage it has reached: a job still being priced is not missing its after
 * photos, it simply has not got there, and listing them as outstanding turns
 * the list into noise nobody reads.
 */
export function outstandingFor(facts: JobFacts): OutstandingItem[] {
  if (facts.stage === "cancelled") return [];

  const items: OutstandingItem[] = [
    { id: "evaluation_booked", label: "Evaluation booked", done: facts.evaluationBooked },
    { id: "evaluation_done", label: "Property evaluated", done: facts.evaluationDone },
    { id: "measured", label: "Zones measured and priced", done: facts.zonesMeasured > 0 },
    {
      id: "proposal_sent",
      label: "Proposal sent",
      done: facts.proposalStatus != null && facts.proposalStatus !== "needs_approval",
    },
    {
      id: "proposal_signed",
      label: "Proposal signed",
      done: facts.proposalStatus === "accepted",
      // Nobody here can sign it for them.
      waiting: facts.proposalStatus === "sent",
    },
  ];

  // Nothing past the sale is owed until the sale is made. Before then these
  // are not outstanding, they are simply not yet.
  const sold = facts.proposalStatus === "accepted";
  if (!sold) return items;

  items.push(
    { id: "booked", label: "Work day booked", done: facts.scheduled },
    { id: "visits", label: "Crew visits booked", done: facts.visitsBooked > 0 }
  );

  for (const kind of PHOTO_STAGES) {
    items.push({
      id: `photos_${kind}`,
      label: photoLabel(facts, kind),
      done: facts.zoneNames.length > 0 && zonesMissing(facts, kind).length === 0,
    });
  }

  items.push(
    {
      id: "walkthrough",
      label: "Manager walked the job",
      done: facts.walkthroughApproved,
      waiting: facts.walkthroughRequested && !facts.walkthroughApproved,
    },
    { id: "signed_off", label: "Job signed off", done: facts.signedOff },
    { id: "invoiced", label: "Invoiced", done: facts.invoiced }
  );

  return items;
}

/**
 * The one thing to do now.
 *
 * The first item nobody here has done and nobody else is holding up. Skipping
 * the waiting ones matters: "waiting on the client to sign" is true but it is
 * not a task, and a page that tells somebody to do something they cannot do
 * is a page they stop reading.
 */
export function dueNext(items: OutstandingItem[]): OutstandingItem | null {
  return items.find((item) => !item.done && !item.waiting) ?? null;
}

/** What is holding it up when there is nothing for us to do. */
export function waitingOn(items: OutstandingItem[]): OutstandingItem | null {
  return items.find((item) => !item.done && item.waiting) ?? null;
}

/** The line at the top of the job. One sentence, always. */
export function dueNextLabel(items: OutstandingItem[]): string {
  const next = dueNext(items);
  if (next) return next.label;

  const waiting = waitingOn(items);
  if (waiting) return `Waiting: ${waiting.label.toLowerCase()}`;

  return items.length === 0 ? "Nothing outstanding" : "All done";
}

/** How much of the job is submitted, for the "3 of 11" on the header. */
export function progress(items: OutstandingItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/**
 * Which section of the job page answers a given outstanding item.
 *
 * So the page can open the right one on arrival. Tapping through three
 * collapsed sections to reach the thing the page just told you was due is
 * the sort of small rudeness that makes people stop trusting a summary.
 */
const SECTION_FOR: Record<string, string> = {
  evaluation_booked: "schedule",
  evaluation_done: "schedule",
  measured: "map",
  proposal_sent: "proposal",
  proposal_signed: "proposal",
  booked: "schedule",
  visits: "visits",
  photos_before: "photos",
  photos_during: "photos",
  photos_after: "photos",
  walkthrough: "walkthrough",
  signed_off: "photos",
  invoiced: "invoice",
};

export function sectionForItem(itemId: string | null | undefined): string | null {
  if (!itemId) return null;
  return SECTION_FOR[itemId] ?? null;
}

/** The section to open when the job page loads, or null to open nothing. */
export function sectionToOpen(items: OutstandingItem[]): string | null {
  return sectionForItem(dueNext(items)?.id ?? null);
}

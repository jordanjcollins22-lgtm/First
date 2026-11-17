/**
 * The client funnel, page by page, for the admin Funnel page: how many
 * people reached each page, how many went on from it, how many stopped
 * there, and how long it took them.
 *
 * Pure, so the counting is tested without a database. The events come from
 * funnel_events, plus the booking page's own opens from booking_visits.
 */

export type FunnelStep =
  | "book_opened"
  | "details_shown"
  | "lead"
  | "map_opened"
  | "map_tapped"
  | "map_sent"
  | "estimate_viewed"
  | "pay_started"
  | "paid"
  | "schedule_viewed"
  | "visit_booked";

/** The steps written to funnel_events. The first, book_opened, is booking_visits. */
export const RECORDED_STEPS: FunnelStep[] = [
  "details_shown",
  "lead",
  "map_opened",
  "map_tapped",
  "map_sent",
  "estimate_viewed",
  "pay_started",
  "paid",
  "schedule_viewed",
  "visit_booked",
];

export function isRecordedStep(value: unknown): value is FunnelStep {
  return typeof value === "string" && (RECORDED_STEPS as string[]).includes(value);
}

export interface FunnelEvent {
  step: FunnelStep;
  /** The booking page visit, before there is a job. */
  visitId: string | null;
  /** The job, once there is one. */
  jobId: string | null;
  detail: string | null;
  at: string;
}

export interface FunnelPage {
  id: string;
  name: string;
  /** What the client sees there, in a line. */
  what: string;
  /** Where it is. Pages after booking are on each client's own link. */
  path: string;
  /** Reaching the page. */
  view: FunnelStep;
  /** Leaving it forwards. */
  done: FunnelStep;
}

export const FUNNEL_PAGES: FunnelPage[] = [
  { id: "address", name: "Booking: where", what: "Types or picks the property's address.", path: "/book", view: "book_opened", done: "details_shown" },
  { id: "details", name: "Booking: your details", what: "Name, email and phone, then on to the project.", path: "/book", view: "details_shown", done: "lead" },
  { id: "map", name: "Map pre-evaluation", what: "Taps each spot, picks what's wanted, adds photos, can draw round it.", path: "/prep/<link>/map", view: "map_opened", done: "map_sent" },
  { id: "estimate", name: "Estimate", what: "Sees the estimate, then pays a deposit (we come to work) or for an evaluation (we come to evaluate).", path: "/prep/<link>/estimate", view: "estimate_viewed", done: "pay_started" },
  { id: "checkout", name: "Card payment", what: "Stripe's checkout, for the deposit or the evaluation.", path: "Stripe", view: "pay_started", done: "paid" },
  { id: "schedule", name: "First day", what: "After a deposit: the day the crew starts work. After a paid evaluation: when the evaluator comes.", path: "/prep/<link>/schedule", view: "schedule_viewed", done: "visit_booked" },
];

export interface PageStats {
  page: FunnelPage;
  /** Distinct people who reached the page. */
  reached: number;
  /** Of those, how many went on from it. */
  completed: number;
  /** completed / reached, as a whole percent. Null when nobody reached it. */
  completionPct: number | null;
  /** Reached it and went no further. */
  stopped: number;
  /** Median minutes from reaching the page to leaving it forwards. Null with nobody to measure. */
  medianMinutes: number | null;
}

export interface FunnelStats {
  pages: PageStats[];
  /** Opened the booking page. */
  started: number;
  /** Paid, either way. */
  paid: number;
  /** paid / started, to one decimal place. */
  paidPct: number | null;
  /** Of those who paid: a deposit, or which evaluation. */
  paidBy: { label: string; count: number }[];
  /** Tapped at least one spot after opening the map: the map's own drop-off is mostly before the first tap. */
  tappedAfterOpening: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(m * 10) / 10;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * Counts each page from the events. A person is their job once they have
 * one, and their booking visit before that: the "lead" event carries both,
 * so somebody who opened the booking page and later paid is one person all
 * the way down, not a visitor who vanished and a job that appeared.
 */
export function funnelStats(events: FunnelEvent[], labelFor: (detail: string) => string = (d) => d): FunnelStats {
  const jobOfVisit = new Map<string, string>();
  for (const e of events) if (e.step === "lead" && e.visitId && e.jobId) jobOfVisit.set(e.visitId, e.jobId);
  const who = (e: FunnelEvent): string | null => {
    if (e.jobId) return `job:${e.jobId}`;
    if (e.visitId) return jobOfVisit.has(e.visitId) ? `job:${jobOfVisit.get(e.visitId)}` : `visit:${e.visitId}`;
    return null;
  };

  // The first time each person reached each step.
  const first = new Map<FunnelStep, Map<string, number>>();
  for (const e of events) {
    const person = who(e);
    const at = Date.parse(e.at);
    if (!person || Number.isNaN(at)) continue;
    const byPerson = first.get(e.step) ?? new Map<string, number>();
    const seen = byPerson.get(person);
    if (seen == null || at < seen) byPerson.set(person, at);
    first.set(e.step, byPerson);
  }
  const reachedStep = (step: FunnelStep) => first.get(step) ?? new Map<string, number>();

  const pages = FUNNEL_PAGES.map((page): PageStats => {
    const viewed = reachedStep(page.view);
    const done = reachedStep(page.done);
    // Went on from it: reached the next step at all. Somebody can land on a
    // later page from a link without the earlier one being recorded, which
    // still counts as having got past this one.
    const went = [...viewed.keys()].filter((p) => done.has(p));
    const minutes = went
      .map((p) => (done.get(p)! - viewed.get(p)!) / 60_000)
      .filter((m) => m >= 0);
    return {
      page,
      reached: viewed.size,
      completed: went.length,
      completionPct: pct(went.length, viewed.size),
      stopped: viewed.size - went.length,
      medianMinutes: median(minutes),
    };
  });

  const started = reachedStep("book_opened").size;
  const paidPeople = reachedStep("paid");
  const paidDetail = new Map<string, string>();
  for (const e of events) {
    const person = who(e);
    if (e.step === "paid" && person && e.detail && !paidDetail.has(person)) paidDetail.set(person, e.detail);
  }
  const counts = new Map<string, number>();
  for (const detail of paidDetail.values()) counts.set(detail, (counts.get(detail) ?? 0) + 1);

  const opened = reachedStep("map_opened");
  const tapped = reachedStep("map_tapped");

  return {
    pages,
    started,
    paid: paidPeople.size,
    paidPct: started > 0 ? Math.round((paidPeople.size / started) * 1000) / 10 : null,
    paidBy: [...counts.entries()]
      .map(([detail, count]) => ({ label: labelFor(detail), count }))
      .sort((a, b) => b.count - a.count),
    tappedAfterOpening: [...opened.keys()].filter((p) => tapped.has(p)).length,
  };
}

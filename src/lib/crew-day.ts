/**
 * A crew member's day, as a strict sequence.
 *
 * The rule that matters: you can only report the step you are actually at.
 * Nobody can say they are on the way to the second house before they have set
 * off for the first, and nobody can finish a stop they never arrived at. That
 * is not tidiness — a day log you can fill in out of order is a day log that
 * tells you nothing about where anybody is.
 *
 * State is derived from the event log rather than stored, so it can never
 * disagree with the record it came from.
 */

export type CrewEventKind =
  | "arrived_shop"
  | "left_shop"
  | "travelling"
  | "arrived_job"
  | "finished_job"
  | "returned_shop";

export interface CrewEvent {
  kind: CrewEventKind;
  jobId: string | null;
  at: string;
}

export interface Stop {
  jobId: string;
  /** The visit this stop is, so hours clocked here land on it. */
  sessionId: string;
  address: string;
  customerName: string;
  lat: number | null;
  lng: number | null;
  purpose: string | null;
  /** Every tool this stop's zones call for, unresolved. Totalled across the
   * day so the crew load once rather than per job. */
}

/** Where the day has got to. */
export type DayPhase =
  | "before_shop"
  | "at_shop"
  | "travelling"
  | "on_site"
  | "between_stops"
  | "stops_done"
  | "day_over";

export interface DayState {
  phase: DayPhase;
  /** The stop the crew is on or heading to. Null off-site between stops. */
  currentStop: Stop | null;
  /** The next stop to set off for, when they are between stops. */
  nextStop: Stop | null;
  stopsDone: string[];
  /** The single thing they can do now, and what to call the button. */
  action: NextAction | null;
  /** Plain-English state, for the top of the screen. */
  headline: string;
}

export interface NextAction {
  kind: CrewEventKind;
  label: string;
  /** The job this action is about, so the button cannot be aimed elsewhere. */
  jobId: string | null;
}

function lastOf(events: CrewEvent[], kind: CrewEventKind): CrewEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].kind === kind) return events[i];
  }
  return null;
}

/**
 * Reads the day.
 *
 * Events must be in the order they happened. Stops must be in the order the
 * crew is meant to work them — the first stop is simply the first one not yet
 * finished, which is what makes the sequence self-correcting if the office
 * reorders the day mid-morning.
 */
export function readDay(events: CrewEvent[], stops: Stop[]): DayState {
  const finished = new Set(
    events.filter((e) => e.kind === "finished_job" && e.jobId).map((e) => e.jobId as string)
  );
  const stopsDone = stops.filter((s) => finished.has(s.jobId)).map((s) => s.jobId);
  const remaining = stops.filter((s) => !finished.has(s.jobId));
  const upNext = remaining[0] ?? null;

  if (lastOf(events, "returned_shop")) {
    return {
      phase: "day_over",
      currentStop: null,
      nextStop: null,
      stopsDone,
      action: null,
      headline: "Day finished. Nice work.",
    };
  }

  if (!lastOf(events, "arrived_shop")) {
    return {
      phase: "before_shop",
      currentStop: null,
      nextStop: upNext,
      stopsDone,
      action: { kind: "arrived_shop", label: "I'm at the shop", jobId: null },
      headline: "Tap when you get to the shop.",
    };
  }

  // On site somewhere? That beats everything else — you are standing on a job.
  const arrivedAt = events.filter((e) => e.kind === "arrived_job" && e.jobId);
  const lastArrival = arrivedAt[arrivedAt.length - 1] ?? null;
  if (lastArrival?.jobId && !finished.has(lastArrival.jobId)) {
    const stop = stops.find((s) => s.jobId === lastArrival.jobId) ?? null;
    return {
      phase: "on_site",
      currentStop: stop,
      nextStop: remaining[1] ?? null,
      stopsDone,
      action: { kind: "finished_job", label: "Finished here", jobId: lastArrival.jobId },
      headline: stop ? `On site at ${stop.address}` : "On site.",
    };
  }

  // Heading somewhere? Only counts if that stop is still outstanding.
  const travelling = events.filter((e) => e.kind === "travelling" && e.jobId);
  const lastTravel = travelling[travelling.length - 1] ?? null;
  if (lastTravel?.jobId && !finished.has(lastTravel.jobId)) {
    const stop = stops.find((s) => s.jobId === lastTravel.jobId) ?? null;
    return {
      phase: "travelling",
      currentStop: stop,
      nextStop: remaining[1] ?? null,
      stopsDone,
      action: { kind: "arrived_job", label: "I've arrived", jobId: lastTravel.jobId },
      headline: stop ? `On the way to ${stop.address}` : "On the way.",
    };
  }

  if (!upNext) {
    return {
      phase: "stops_done",
      currentStop: null,
      nextStop: null,
      stopsDone,
      action: { kind: "returned_shop", label: "Back at the shop", jobId: null },
      headline: "All stops done. Head back to the shop.",
    };
  }

  if (!lastOf(events, "left_shop")) {
    return {
      phase: "at_shop",
      currentStop: null,
      nextStop: upNext,
      stopsDone,
      action: { kind: "left_shop", label: "Leaving the shop", jobId: null },
      headline: `At the shop. First stop: ${upNext.address}`,
    };
  }

  return {
    phase: "between_stops",
    currentStop: null,
    nextStop: upNext,
    stopsDone,
    action: { kind: "travelling", label: `On my way to ${upNext.customerName}`, jobId: upNext.jobId },
    headline: `Next: ${upNext.address}`,
  };
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Whether a crew member may record this, right now.
 *
 * Checked on the server as well as used to build the button, because the
 * button is a convenience and this is the rule. A phone that has been in a
 * pocket since this morning holds a stale page, and a stale page must not be
 * able to report a step the day has not reached.
 */
export function canRecord(
  events: CrewEvent[],
  stops: Stop[],
  kind: CrewEventKind,
  jobId: string | null
): Verdict {
  const state = readDay(events, stops);
  const action = state.action;

  if (!action) return { ok: false, reason: "Your day is already finished." };

  if (action.kind !== kind) {
    return { ok: false, reason: `You can't do that yet — ${describe(action)}.` };
  }

  // The action names its own job, so "on the way to the second house" cannot
  // be reported against the first, or vice versa.
  if ((action.jobId ?? null) !== (jobId ?? null)) {
    const meant = stops.find((s) => s.jobId === action.jobId);
    return {
      ok: false,
      reason: meant
        ? `That's not the stop you're on. You're due at ${meant.address}.`
        : "That's not the stop you're on.",
    };
  }

  return { ok: true };
}

function describe(action: NextAction): string {
  switch (action.kind) {
    case "arrived_shop":
      return "say when you're at the shop first";
    case "left_shop":
      return "say when you're leaving the shop first";
    case "travelling":
      return "say you're on your way first";
    case "arrived_job":
      return "say when you've arrived first";
    case "finished_job":
      return "finish the stop you're on first";
    case "returned_shop":
      return "you're done — head back to the shop";
  }
}

/** Minutes between the first and last event, for the day summary. */
export function minutesElapsed(events: CrewEvent[], now: Date = new Date()): number | null {
  if (events.length === 0) return null;
  const start = new Date(events[0].at).getTime();
  const end = lastOf(events, "returned_shop") ? new Date(events[events.length - 1].at).getTime() : now.getTime();
  return Math.max(0, Math.round((end - start) / 60_000));
}

/**
 * Where "Directions" goes: the app's own directions screen for that stop.
 *
 * It used to hand straight off to Google Maps, which works but is a one-way
 * door — the crew leave, and the tap that says "I'm on the way" is now three
 * apps back. The in-app screen keeps that a tap away and still offers the
 * handover to a real navigation app for anybody who wants spoken turns.
 */
export function directionsUrl(stop: Stop): string {
  return `/jobs/${stop.jobId}/directions`;
}

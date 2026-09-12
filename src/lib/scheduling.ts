/**
 * Appointment windows and work visits.
 *
 * An evaluation used to be an instant. Without a length nothing could tell
 * that two visits collided, and nobody could see how long one was meant to
 * take. A job's work was one start and one end, which cannot describe work
 * that pauses or takes three separate trips.
 *
 * Pure functions, so the rules can be tested without a database and the UI can
 * grey out a button using the same reasoning the server will apply.
 */

import type { JobWorkSession, TicketCause, TicketStatus, WorkSessionStatus } from "@/types/domain";

/**
 * How long a visit is assumed to run when no end was recorded.
 *
 * Rows written before evaluations had an end genuinely do not know their
 * length, and writing a guess into the database would make the guess
 * indistinguishable from a fact. The assumption lives here instead, where it
 * is visible and only affects display and overlap.
 */
export const DEFAULT_EVALUATION_MINUTES = 60;

export interface Window {
  start: Date;
  end: Date;
}

/** The window an evaluation occupies, filling in a default end when the row
 * has none. Returns null when nothing is booked at all. */
export function evaluationWindow(
  startIso: string | null,
  endIso: string | null,
  defaultMinutes = DEFAULT_EVALUATION_MINUTES
): Window | null {
  if (!startIso) return null;
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return null;

  if (endIso) {
    const end = new Date(endIso);
    // An end at or before the start is bad data, not a zero-length meeting.
    if (!Number.isNaN(end.getTime()) && end > start) return { start, end };
  }
  return { start, end: new Date(start.getTime() + defaultMinutes * 60_000) };
}

/** Minutes an evaluation runs for, default included. */
export function evaluationMinutes(startIso: string | null, endIso: string | null): number | null {
  const window = evaluationWindow(startIso, endIso);
  if (!window) return null;
  return Math.round((window.end.getTime() - window.start.getTime()) / 60_000);
}

/**
 * Whether two windows collide.
 *
 * Touching is not overlapping: a visit ending at 10:00 and the next starting
 * at 10:00 is a back-to-back day, not a double booking.
 */
export function windowsOverlap(a: Window, b: Window): boolean {
  return a.start < b.end && b.start < a.end;
}

export type Verdict = { ok: true } | { ok: false; reason: string };

/** Validates an appointment's start/end pair before it is saved. */
export function validateAppointment(startIso: string | null, endIso: string | null): Verdict {
  if (!startIso && !endIso) return { ok: true };
  if (!startIso) return { ok: false, reason: "Give it a start time as well as an end time." };
  if (!endIso) return { ok: true };

  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return { ok: false, reason: "That isn't a valid date and time." };
  }
  if (end <= start) return { ok: false, reason: "The end time is before the start time." };

  // A day-long "evaluation" is nearly always a typo in the date, and it blocks
  // an evaluator's whole calendar if it isn't.
  const hours = (end.getTime() - start.getTime()) / 3_600_000;
  if (hours > 12) return { ok: false, reason: "That's over 12 hours — check the dates." };
  return { ok: true };
}

/* ------------------------------------------------------------- work visits */

export const SESSION_STATUS_LABELS: Record<WorkSessionStatus, string> = {
  scheduled: "Scheduled",
  in_progress: "On site",
  paused: "Paused",
  done: "Done",
  cancelled: "Cancelled",
};

export type SessionShape = Pick<JobWorkSession, "starts_on" | "ends_on" | "status">;

/** A cancelled visit is not part of the job's window — a called-off trip
 * should not stretch the dates the calendar draws. */
export function countsTowardWindow(session: SessionShape): boolean {
  return session.status !== "cancelled";
}

/**
 * The job's overall window, derived from its visits.
 *
 * The database keeps jobs.project_start_date / project_end_date in step with
 * this by trigger. This is the same rule in TypeScript, so the UI can show the
 * window it is about to create before saving.
 */
export function jobWindow(sessions: SessionShape[]): { start: string; end: string } | null {
  const live = sessions.filter(countsTowardWindow);
  if (live.length === 0) return null;
  return {
    start: live.reduce((min, s) => (s.starts_on < min ? s.starts_on : min), live[0].starts_on),
    end: live.reduce((max, s) => (s.ends_on > max ? s.ends_on : max), live[0].ends_on),
  };
}

/** Validates one visit's dates. */
export function validateSession(startsOn: string, endsOn: string): Verdict {
  if (!startsOn) return { ok: false, reason: "Pick a start date." };
  if (!endsOn) return { ok: false, reason: "Pick an end date." };
  if (endsOn < startsOn) return { ok: false, reason: "The end date is before the start date." };
  return { ok: true };
}

/** Which visits sit on a given day, for the calendar. Cancelled ones don't. */
export function sessionsOnDate(sessions: SessionShape[], dateKey: string): SessionShape[] {
  return sessions.filter(
    (s) => countsTowardWindow(s) && s.starts_on <= dateKey && dateKey <= s.ends_on
  );
}

/**
 * Whether a job still has work outstanding.
 *
 * Anything not done and not cancelled counts — a paused visit is unfinished
 * work, which is the whole reason for recording the pause.
 */
export function hasOutstandingWork(sessions: SessionShape[]): boolean {
  return sessions.some((s) => s.status !== "done" && s.status !== "cancelled");
}

/* ---------------------------------------------------------------- tickets */

export const TICKET_CAUSE_LABELS: Record<TicketCause, string> = {
  workmanship: "Our workmanship",
  material_failure: "Material failed",
  design: "Design didn't suit the site",
  weather: "Weather",
  client_change: "Client changed their mind",
  unknown: "Not established",
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  scheduled: "Visit booked",
  resolved: "Resolved",
  closed: "Closed",
};

/** Tickets that still need somebody to do something. */
export function isTicketOpen(status: TicketStatus): boolean {
  return status === "open" || status === "scheduled";
}

/**
 * What to do about each appointment on the GoHighLevel calendar.
 *
 * Pure: takes what GoHighLevel says and what the app has, and returns the
 * changes. Tested without a token. The rules are few. An appointment we
 * already know is moved or cancelled to match. One we do not know is
 * linked to an app booking by the same person at the same time, which is
 * our own booking echoed back, or otherwise created. The same person
 * already booked at that time under another appointment is a duplicate on
 * the calendar, not a second visit, and is left alone. A cancelled
 * appointment we never had is nothing to do.
 */
export interface GhlEvent {
  id: string;
  contactId: string | null;
  startTime: string;
  endTime: string | null;
  cancelled: boolean;
}

export interface KnownJob {
  id: string;
  ghlAppointmentId: string | null;
  evaluationAt: string | null;
  evaluationEndAt: string | null;
  cancelled: boolean;
  email: string | null;
  phone: string | null;
  /** The client's GoHighLevel contact, once known. The surest match of all. */
  ghlContactId?: string | null;
  /**
   * The app's time is the newer one.
   *
   * Set when a visit is moved in the app without the calendar being told.
   * The pull pushes the app's time to the calendar instead of reading the
   * calendar's time over it, which is what it did before and how a visit
   * moved in the database got moved back the next time anybody opened
   * My Day.
   */
  pushPending?: boolean;
}

export type Change =
  | { kind: "push"; jobId: string }
  | { kind: "move"; jobId: string; startTime: string; endTime: string | null }
  | { kind: "cancel"; jobId: string }
  | { kind: "reinstate"; jobId: string; startTime: string; endTime: string | null }
  | { kind: "link"; jobId: string; appointmentId: string }
  | { kind: "create"; event: GhlEvent }
  | { kind: "skip"; appointmentId: string; why: string };

function sameInstant(a: string | null, b: string | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60_000;
}

export function digits(value: string | null): string {
  return (value ?? "").replace(/\D/g, "").slice(-10);
}

/** Whether a job's client is the person on the appointment: the same GoHighLevel contact, or the same email or phone. */
export function samePerson(job: KnownJob, contact: { id?: string | null; email: string | null; phone: string | null }): boolean {
  if (job.ghlContactId && contact.id && job.ghlContactId === contact.id) return true;
  if (job.email && contact.email && job.email.trim().toLowerCase() === contact.email.trim().toLowerCase()) return true;
  const a = digits(job.phone);
  const b = digits(contact.phone);
  return a.length >= 7 && a === b;
}

export function planChanges(
  events: readonly GhlEvent[],
  jobs: readonly KnownJob[],
  contactOf: (contactId: string | null) => { id?: string | null; email: string | null; phone: string | null } | null
): Change[] {
  const byAppointment = new Map(jobs.filter((j) => j.ghlAppointmentId).map((j) => [j.ghlAppointmentId as string, j]));
  const out: Change[] = [];

  // A visit the app moved goes out to the calendar, whether or not the
  // calendar has it yet. Listed first, so the pass over the calendar's
  // events below never reads an older time over it.
  const pushed = new Set<string>();
  for (const job of jobs) {
    if (job.pushPending && !job.cancelled && job.evaluationAt) {
      out.push({ kind: "push", jobId: job.id });
      pushed.add(job.id);
    }
  }

  for (const event of events) {
    const known = byAppointment.get(event.id);
    if (known) {
      if (pushed.has(known.id)) continue;
      if (event.cancelled && !known.cancelled) out.push({ kind: "cancel", jobId: known.id });
      else if (!event.cancelled && known.cancelled)
        out.push({ kind: "reinstate", jobId: known.id, startTime: event.startTime, endTime: event.endTime });
      else if (!event.cancelled && !(sameInstant(known.evaluationAt, event.startTime) && sameInstant(known.evaluationEndAt, event.endTime)))
        out.push({ kind: "move", jobId: known.id, startTime: event.startTime, endTime: event.endTime });
      continue;
    }

    if (event.cancelled) {
      out.push({ kind: "skip", appointmentId: event.id, why: "cancelled before we knew it" });
      continue;
    }

    const contact = contactOf(event.contactId);
    const same = contact ? jobs.filter((j) => !j.cancelled && sameInstant(j.evaluationAt, event.startTime) && samePerson(j, contact)) : [];
    const echo = same.find((j) => !j.ghlAppointmentId);
    if (echo) {
      out.push({ kind: "link", jobId: echo.id, appointmentId: event.id });
      continue;
    }
    if (same.length > 0) {
      out.push({ kind: "skip", appointmentId: event.id, why: `the same person is already booked then on job ${same[0].id}` });
      continue;
    }

    out.push({ kind: "create", event });
  }
  return out;
}

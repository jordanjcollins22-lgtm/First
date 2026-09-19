/**
 * What to do about each appointment on the GoHighLevel calendar.
 *
 * Pure: takes what GoHighLevel says and what the app has, and returns the
 * changes. Tested without a token. The rules are few. An appointment we
 * already know is moved or cancelled to match. One we do not know is
 * linked to an app booking by the same person at the same time, which is
 * our own booking echoed back, or otherwise created. A cancelled
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
}

export type Change =
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

/** Whether a job's client is the person on the appointment, by email or phone. */
export function samePerson(job: KnownJob, contact: { email: string | null; phone: string | null }): boolean {
  if (job.email && contact.email && job.email.trim().toLowerCase() === contact.email.trim().toLowerCase()) return true;
  const a = digits(job.phone);
  const b = digits(contact.phone);
  return a.length >= 7 && a === b;
}

export function planChanges(
  events: readonly GhlEvent[],
  jobs: readonly KnownJob[],
  contactOf: (contactId: string | null) => { email: string | null; phone: string | null } | null
): Change[] {
  const byAppointment = new Map(jobs.filter((j) => j.ghlAppointmentId).map((j) => [j.ghlAppointmentId as string, j]));
  const out: Change[] = [];

  for (const event of events) {
    const known = byAppointment.get(event.id);
    if (known) {
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
    const echo = contact
      ? jobs.find((j) => !j.ghlAppointmentId && !j.cancelled && sameInstant(j.evaluationAt, event.startTime) && samePerson(j, contact))
      : undefined;
    if (echo) {
      out.push({ kind: "link", jobId: echo.id, appointmentId: event.id });
      continue;
    }

    out.push({ kind: "create", event });
  }
  return out;
}

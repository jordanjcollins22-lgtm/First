import { describe, expect, it } from "vitest";

import { planChanges, samePerson, type GhlEvent, type KnownJob } from "./plan";

const at = "2026-09-16T13:00:00.000Z";
const end = "2026-09-16T14:00:00.000Z";
function job(over: Partial<KnownJob>): KnownJob {
  return { id: "j1", ghlAppointmentId: null, evaluationAt: at, evaluationEndAt: end, cancelled: false, email: "k@x.com", phone: "4105550101", ...over };
}
function event(over: Partial<GhlEvent>): GhlEvent {
  return { id: "a1", contactId: "c1", startTime: at, endTime: end, cancelled: false, ...over };
}
const contacts = (id: string | null) => (id === "c1" ? { email: "K@X.com", phone: "(410) 555-0101" } : null);

describe("planChanges", () => {
  it("does nothing when the calendars already agree", () => {
    expect(planChanges([event({})], [job({ ghlAppointmentId: "a1" })], contacts)).toEqual([]);
  });

  it("moves a known appointment that moved in GoHighLevel", () => {
    const moved = event({ startTime: "2026-09-16T15:00:00.000Z", endTime: "2026-09-16T16:00:00.000Z" });
    expect(planChanges([moved], [job({ ghlAppointmentId: "a1" })], contacts)).toEqual([
      { kind: "move", jobId: "j1", startTime: moved.startTime, endTime: moved.endTime },
    ]);
  });

  it("cancels and reinstates to match", () => {
    expect(planChanges([event({ cancelled: true })], [job({ ghlAppointmentId: "a1" })], contacts)).toEqual([{ kind: "cancel", jobId: "j1" }]);
    expect(planChanges([event({})], [job({ ghlAppointmentId: "a1", cancelled: true })], contacts)).toEqual([
      { kind: "reinstate", jobId: "j1", startTime: at, endTime: end },
    ]);
  });

  it("links our own booking echoed back rather than making it twice", () => {
    expect(planChanges([event({})], [job({})], contacts)).toEqual([{ kind: "link", jobId: "j1", appointmentId: "a1" }]);
  });

  it("links by the GoHighLevel contact when the email and phone differ", () => {
    const byContact = (id: string | null) => (id === "c1" ? { id: "c1", email: null, phone: null } : null);
    expect(planChanges([event({})], [job({ ghlContactId: "c1", email: null, phone: null })], byContact)).toEqual([
      { kind: "link", jobId: "j1", appointmentId: "a1" },
    ]);
  });

  it("leaves a second appointment for the same person at the same time alone", () => {
    const changes = planChanges([event({ id: "a2" })], [job({ ghlAppointmentId: "a1" })], contacts);
    expect(changes).toEqual([{ kind: "skip", appointmentId: "a2", why: "the same person is already booked then on job j1" }]);
  });

  it("creates a booking it has never seen and skips one cancelled before it was seen", () => {
    const changes = planChanges([event({ id: "a9", contactId: "c9" }), event({ id: "a8", cancelled: true })], [], contacts);
    expect(changes[0]).toMatchObject({ kind: "create" });
    expect(changes[1]).toMatchObject({ kind: "skip", appointmentId: "a8" });
  });
});

describe("samePerson", () => {
  it("matches on email or the last ten digits of the phone", () => {
    expect(samePerson(job({}), { email: null, phone: "+1 410-555-0101" })).toBe(true);
    expect(samePerson(job({ phone: null }), { email: "k@x.com", phone: null })).toBe(true);
    expect(samePerson(job({}), { email: "other@x.com", phone: "4105559999" })).toBe(false);
  });
});

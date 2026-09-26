import { describe, expect, it } from "vitest";

import { digest, isStale, staleAfter, staleLine, waitingLine, whatLabel } from "./outbound-approval";

const now = new Date("2026-09-20T12:00:00Z");

describe("staleAfter", () => {
  it("gives a morning-of email hours and a booking days", () => {
    expect(staleAfter("evaluation_morning_of", now).toISOString()).toBe("2026-09-20T15:00:00.000Z");
    expect(staleAfter("evaluation_booked", now).toISOString()).toBe("2026-09-23T12:00:00.000Z");
    expect(staleAfter("invoice_reminder", now).toISOString()).toBe("2026-09-27T12:00:00.000Z");
  });
  it("knows when it is over", () => {
    expect(isStale("2026-09-20T11:59:00Z", now)).toBe(true);
    expect(isStale("2026-09-20T12:01:00Z", now)).toBe(false);
    expect(isStale(null, now)).toBe(false);
  });
});

describe("wording", () => {
  it("names each kind plainly", () => {
    expect(whatLabel("evaluation_booked")).toBe("Booking confirmation");
    expect(whatLabel("proposal_follow_up")).toBe("Proposal follow-up");
    expect(whatLabel("something_new")).toBe("something new");
  });
  it("says how long is left", () => {
    expect(staleLine("2026-09-20T15:00:00Z", now)).toBe("Goes stale in 3 hours");
    expect(staleLine("2026-09-23T12:00:00Z", now)).toBe("Goes stale in 3 days");
    expect(staleLine("2026-09-20T11:00:00Z", now)).toBe("Too late to send");
  });
  it("counts in the subject and lists who", () => {
    expect(waitingLine(1)).toBe("1 email is waiting for your OK");
    const note = digest({
      items: [
        { toName: "Daniel Piotrowski", toEmail: "d@x.com", kind: "evaluation_booked", expiresAt: "2026-09-23T12:00:00Z" },
        { toName: null, toEmail: "k@x.com", kind: "proposal_follow_up", expiresAt: null },
      ],
      link: "https://app/my-day",
      now,
    });
    expect(note.subject).toBe("2 emails are waiting for your OK");
    expect(note.text).toContain("Booking confirmation to Daniel Piotrowski (goes stale in 3 days)");
    expect(note.text).toContain("Proposal follow-up to k@x.com");
    expect(note.text).toContain("https://app/my-day");
    expect(note.text).not.toMatch(/[—–]/);
  });
});

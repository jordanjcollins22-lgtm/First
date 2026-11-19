import { describe, expect, it } from "vitest";

import { closeBlocker, closeUpdate, sentAgo, workOf } from "@/lib/proposal-outcome";

describe("closing an open proposal", () => {
  it("needs a Yes or No and a reason", () => {
    expect(closeBlocker(null, "went with someone else")).toBe("Pick Yes or No first.");
    expect(closeBlocker("lost", "")).toBe("Say why we lost it.");
    expect(closeBlocker("won", "  ok ")).toBe("Say why they said yes.");
    expect(closeBlocker("lost", "Price too high")).toBeNull();
  });

  it("won is accepted with the reason kept", () => {
    const u = closeUpdate("won", " Said yes on the phone ", "me", new Date("2026-11-19T12:00:00Z"));
    expect(u).toMatchObject({ status: "accepted", close_reason: "Said yes on the phone", closed_by: "me" });
    expect("office_declined_by" in u).toBe(false);
  });

  it("lost is declined by the office, so win-back leaves it alone", () => {
    const u = closeUpdate("lost", "Went with another company", "me", new Date("2026-11-19T12:00:00Z"));
    expect(u).toMatchObject({ status: "declined", office_declined_by: "me", office_declined_from: "sent", closed_at: "2026-11-19T12:00:00.000Z" });
  });

  it("reads the age and the work", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(sentAgo("2026-11-06T12:00:00Z", now)).toBe("Sent 13 days ago");
    expect(sentAgo("2026-11-19T08:00:00Z", now)).toBe("Sent today");
    expect(sentAgo(null, now)).toBe("Not sent yet");
    expect(workOf("505 Underwood Lane, Bel Air, Leaf removal")).toBe("Leaf removal");
    expect(workOf("Mulch")).toBe("Mulch");
  });
});

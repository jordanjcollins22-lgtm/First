import { describe, expect, it } from "vitest";

import { closeRate, composeDigest, digestKey, isDigestTime, isOverdue, lastWeek, type WeekKpis } from "./digest";

describe("isDigestTime", () => {
  it("is Monday from 7am Eastern, in summer and winter time", () => {
    // 11:00 UTC is 7am EDT; 12:00 UTC is 7am EST.
    expect(isDigestTime(new Date("2026-10-12T11:00:00Z"))).toBe(true);
    expect(isDigestTime(new Date("2026-10-12T10:59:00Z"))).toBe(false);
    expect(isDigestTime(new Date("2026-12-07T11:00:00Z"))).toBe(false);
    expect(isDigestTime(new Date("2026-12-07T12:00:00Z"))).toBe(true);
    expect(isDigestTime(new Date("2026-10-13T11:00:00Z"))).toBe(false);
  });
});

describe("lastWeek", () => {
  it("is the Monday-to-Monday week before this one, on the business's clock", () => {
    const w = lastWeek(new Date("2026-10-12T11:00:00Z"));
    expect(w.startKey).toBe("2026-10-05");
    expect(w.endKey).toBe("2026-10-12");
    expect(w.start.toISOString()).toBe("2026-10-05T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-12T04:00:00.000Z");
  });
  it("on a Sunday, still the last whole week", () => {
    expect(lastWeek(new Date("2026-10-18T15:00:00Z")).startKey).toBe("2026-10-05");
  });
  it("keys the digest by its week, so both Monday runs share one key", () => {
    expect(digestKey(new Date("2026-10-12T11:00:00Z"))).toBe(digestKey(new Date("2026-10-12T12:00:00Z")));
    expect(digestKey(new Date("2026-10-12T11:00:00Z"))).toBe("owner_digest:2026-10-12");
  });
});

describe("closeRate", () => {
  it("is won over decided", () => {
    expect(closeRate(21, 26)).toBe(45);
    expect(closeRate(0, 0)).toBeNull();
  });
});

describe("isOverdue", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("counts open invoices more than 30 days out", () => {
    expect(isOverdue({ status: "open", sentAt: "2026-09-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" }, now)).toBe(true);
    expect(isOverdue({ status: "open", sentAt: "2026-10-01T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" }, now)).toBe(false);
    expect(isOverdue({ status: "paid", sentAt: "2026-08-01T00:00:00Z", createdAt: "2026-08-01T00:00:00Z" }, now)).toBe(false);
  });
});

describe("composeDigest", () => {
  const kpis: WeekKpis = {
    marketing: { leads: 7 },
    sales: { bookedEvaluations: 4, proposalsSent: 3, proposalsWon: 2, proposalsLost: 1 },
    operations: { jobsCompleted: 1 },
    admin: { invoiced: 4200.4, collected: 3100, arOverdue: 950, arOverdueCount: 2 },
  };

  it("says what is waiting, each department's week, and where to go", () => {
    const d = composeDigest({
      businessName: "JS Landscaping MD",
      week: { startKey: "2026-10-05", endKey: "2026-10-12" },
      queueCount: 3,
      queueByType: [
        { label: "Email", count: 2 },
        { label: "Price", count: 1 },
        { label: "Social post", count: 0 },
      ],
      kpis,
      exceptions: [{ title: "Equipment broke (work stopped)", detail: "Mower down at Smith" }],
      link: "https://app.example.com/v2",
    });
    expect(d.subject).toBe("Monday digest: 3 waiting for you");
    expect(d.text).toContain("week of Oct 5–Oct 11");
    expect(d.text).toContain("3 waiting for you: 2 emails, 1 price.");
    expect(d.text).toContain("Marketing: 7 new leads.");
    expect(d.text).toContain("Sales: 4 evaluations booked; 3 proposals sent, 2 won, 1 lost (67% close rate).");
    expect(d.text).toContain("Operations: 1 job completed.");
    expect(d.text).toContain("Admin: $4,200 invoiced, $3,100 collected; $950 overdue on 2 invoices.");
    expect(d.text).toContain("- Equipment broke (work stopped): Mower down at Smith");
    expect(d.text).toContain("Open the queue: https://app.example.com/v2");
  });

  it("is plain when nothing is waiting and nothing decided", () => {
    const d = composeDigest({
      businessName: "B",
      week: { startKey: "2026-10-05", endKey: "2026-10-12" },
      queueCount: 0,
      queueByType: [],
      kpis: { ...kpis, sales: { bookedEvaluations: 0, proposalsSent: 0, proposalsWon: 0, proposalsLost: 0 }, admin: { invoiced: 0, collected: 0, arOverdue: 0, arOverdueCount: 0 } },
      exceptions: [],
      link: "x",
    });
    expect(d.subject).toBe("Monday digest: Oct 5–Oct 11");
    expect(d.text).toContain("Nothing is waiting for you.");
    expect(d.text).not.toContain("close rate");
    expect(d.text).toContain("nothing overdue");
    expect(d.text).not.toContain("Top exceptions");
  });
});

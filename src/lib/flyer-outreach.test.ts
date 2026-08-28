import { describe, expect, it } from "vitest";

import {
  callOrder,
  isFinal,
  outcomeLabel,
  OUTCOMES,
  outreachLabel,
  outreachTotals,
  since,
  summariseOutreach,
  type Touch,
} from "./flyer-outreach";

const NOW = new Date("2026-09-20T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

let nextId = 0;
function touch(over: Partial<Touch> = {}): Touch {
  return { id: `t${nextId++}`, outcome: "attempted", note: null, at: daysAgo(1), ...over };
}

describe("the replies we record", () => {
  it("runs coldest to warmest and ends with the two finals", () => {
    expect(OUTCOMES.map((o) => o.value)).toEqual([
      "attempted",
      "reached",
      "interested",
      "booked",
      "not_interested",
      "do_not_contact",
    ]);
  });

  it("names every one", () => {
    for (const outcome of OUTCOMES) {
      expect(outcomeLabel(outcome.value)).toBe(outcome.label);
    }
  });

  it("falls back rather than showing a raw value", () => {
    expect(outcomeLabel("nonsense")).toBe("Contacted");
  });

  it("uses no dashes", () => {
    for (const outcome of OUTCOMES) {
      expect(`${outcome.label} ${outcome.blurb}`).not.toMatch(/[—–]/);
    }
  });
});

describe("isFinal", () => {
  it("is true for somebody who bought or asked us to stop", () => {
    expect(isFinal("booked")).toBe(true);
    expect(isFinal("do_not_contact")).toBe(true);
  });

  it("is false for a no that means not this run", () => {
    // "Not interested" in September is a perfectly good call in March.
    expect(isFinal("not_interested")).toBe(false);
    expect(isFinal(null)).toBe(false);
  });
});

describe("summariseOutreach", () => {
  it("is empty for somebody nobody has rung", () => {
    expect(summariseOutreach([])).toEqual({
      count: 0,
      lastAt: null,
      lastOutcome: null,
      lastNote: null,
    });
  });

  it("counts every attempt", () => {
    expect(summariseOutreach([touch(), touch(), touch()]).count).toBe(3);
  });

  it("takes the latest outcome whatever order the rows arrive in", () => {
    const summary = summariseOutreach([
      touch({ outcome: "attempted", at: daysAgo(9) }),
      touch({ outcome: "interested", at: daysAgo(2) }),
      touch({ outcome: "reached", at: daysAgo(5) }),
    ]);
    expect(summary.lastOutcome).toBe("interested");
    expect(summary.lastAt).toBe(daysAgo(2));
  });

  it("keeps the most recent note there is, not just the last touch's", () => {
    // "Call me in March" said two calls ago is still the useful thing on the
    // row, and a later no-answer should not wipe it off the screen.
    const summary = summariseOutreach([
      touch({ note: "Call me in March", at: daysAgo(9) }),
      touch({ note: null, at: daysAgo(1) }),
    ]);
    expect(summary.lastNote).toBe("Call me in March");
  });

  it("ignores a note that is only whitespace", () => {
    expect(summariseOutreach([touch({ note: "   " })]).lastNote).toBeNull();
  });
});

describe("since", () => {
  it("reads the way somebody would say it", () => {
    expect(since(daysAgo(0), NOW)).toBe("today");
    expect(since(daysAgo(1), NOW)).toBe("yesterday");
    expect(since(daysAgo(6), NOW)).toBe("6 days ago");
    expect(since(daysAgo(70), NOW)).toBe("2 months ago");
  });

  it("says nothing for a timestamp it cannot read", () => {
    expect(since("nope", NOW)).toBe("");
  });
});

describe("outreachLabel", () => {
  it("says plainly when nobody has been rung", () => {
    expect(outreachLabel(summariseOutreach([]), NOW)).toBe("Not contacted yet");
  });

  it("puts the count, the reply and the when together", () => {
    // Any one alone misleads: "3 times" could all be last March, and
    // "interested" could have been a year ago.
    const summary = summariseOutreach([
      touch({ at: daysAgo(9) }),
      touch({ outcome: "interested", at: daysAgo(3) }),
    ]);
    expect(outreachLabel(summary, NOW)).toBe("2 times, interested, 3 days ago");
  });

  it("reads naturally for one call", () => {
    expect(outreachLabel(summariseOutreach([touch({ outcome: "reached" })]), NOW)).toBe(
      "Once, spoke to them, yesterday"
    );
  });
});

describe("callOrder", () => {
  const rows = [
    { id: "never", summary: summariseOutreach([]) },
    { id: "old", summary: summariseOutreach([touch({ at: daysAgo(30) })]) },
    { id: "recent", summary: summariseOutreach([touch({ at: daysAgo(1) })]) },
    { id: "sold", summary: summariseOutreach([touch({ outcome: "booked" })]) },
    { id: "stop", summary: summariseOutreach([touch({ outcome: "do_not_contact" })]) },
  ];

  it("drops anybody who bought or asked us to stop", () => {
    expect(callOrder(rows).map((r) => r.id)).not.toContain("sold");
    expect(callOrder(rows).map((r) => r.id)).not.toContain("stop");
  });

  it("puts the never-tried first, then whoever has waited longest", () => {
    // Sorting by "most promising" sounds better and is how the bottom of a
    // list never gets called.
    expect(callOrder(rows).map((r) => r.id)).toEqual(["never", "old", "recent"]);
  });

  it("keeps a not-interested in the list for another day", () => {
    const later = [{ id: "no", summary: summariseOutreach([touch({ outcome: "not_interested" })]) }];
    expect(callOrder(later)).toHaveLength(1);
  });

  it("does not reorder the caller's own array", () => {
    const before = rows.map((r) => r.id);
    callOrder(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });
});

describe("outreachTotals", () => {
  it("counts the list the way somebody would report it", () => {
    const totals = outreachTotals([
      summariseOutreach([]),
      summariseOutreach([touch()]),
      summariseOutreach([touch({ outcome: "interested" })]),
      summariseOutreach([touch({ outcome: "booked" })]),
    ]);
    expect(totals).toEqual({ businesses: 4, contacted: 3, interested: 1, sold: 1 });
  });
});

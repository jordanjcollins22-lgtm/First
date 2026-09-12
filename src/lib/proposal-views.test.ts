import { describe, expect, it } from "vitest";

import {
  DEDUPE_MINUTES,
  activityLabel,
  isHot,
  isSameSitting,
  isWarm,
  summariseViews,
  timeAgo,
  viewLabel,
  watchingFor,
  type ViewRow,
  type ViewSummary,
} from "./proposal-views";

const NOW = new Date("2026-09-07T12:00:00Z");

function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function row(minutes: number, visitorHash: string | null = "client"): ViewRow {
  return { viewedAt: ago(minutes), visitorHash };
}

describe("summariseViews", () => {
  it("is empty when nobody has opened it", () => {
    expect(summariseViews([])).toEqual({
      opens: 0,
      people: 0,
      firstAt: null,
      lastAt: null,
      inLastHour: 0,
      inLastDay: 0,
    });
  });

  it("counts the opens", () => {
    expect(summariseViews([row(10), row(120), row(3000)]).opens).toBe(3);
  });

  it("finds the first and last regardless of the order they arrive in", () => {
    const summary = summariseViews([row(120), row(10), row(3000)]);
    expect(summary.firstAt).toBe(ago(3000));
    expect(summary.lastAt).toBe(ago(10));
  });

  it("counts one person opening it repeatedly as one person", () => {
    const summary = summariseViews([row(10), row(120), row(3000)]);
    expect(summary.opens).toBe(3);
    expect(summary.people).toBe(1);
  });

  it("separates a client from their spouse on the same proposal", () => {
    const summary = summariseViews([row(10, "client"), row(20, "spouse"), row(30, "client")]);
    expect(summary.people).toBe(2);
  });

  it("does not collapse every anonymous open into one person", () => {
    // Two rows we cannot tell apart are two rows we cannot tell apart, not
    // proof they were the same visitor.
    expect(summariseViews([row(10, null), row(20, null)]).people).toBe(2);
  });
});

describe("isSameSitting", () => {
  it("is false when there is nothing to compare to", () => {
    expect(isSameSitting(null, NOW)).toBe(false);
  });

  it("treats a refresh as the same sitting", () => {
    expect(isSameSitting(ago(1), NOW)).toBe(true);
    expect(isSameSitting(ago(DEDUPE_MINUTES - 1), NOW)).toBe(true);
  });

  it("treats coming back later as a new view", () => {
    expect(isSameSitting(ago(DEDUPE_MINUTES), NOW)).toBe(false);
    expect(isSameSitting(ago(240), NOW)).toBe(false);
  });

  it("does not log a second view because a clock ran fast", () => {
    expect(isSameSitting(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe(true);
  });

  it("ignores a timestamp it cannot read", () => {
    expect(isSameSitting("not a date", NOW)).toBe(false);
  });
});

describe("timeAgo", () => {
  it("reads the way somebody would say it", () => {
    expect(timeAgo(ago(0), NOW)).toBe("just now");
    expect(timeAgo(ago(1), NOW)).toBe("1 minute ago");
    expect(timeAgo(ago(45), NOW)).toBe("45 minutes ago");
    expect(timeAgo(ago(60), NOW)).toBe("1 hour ago");
    expect(timeAgo(ago(300), NOW)).toBe("5 hours ago");
    expect(timeAgo(ago(60 * 24), NOW)).toBe("yesterday");
    expect(timeAgo(ago(60 * 24 * 4), NOW)).toBe("4 days ago");
    expect(timeAgo(ago(60 * 24 * 60), NOW)).toBe("2 months ago");
  });

  it("says nothing rather than nonsense for a bad timestamp", () => {
    expect(timeAgo("nope", NOW)).toBe("");
  });
});

describe("viewLabel", () => {
  it("says plainly when it has not been opened", () => {
    // The most useful thing this feature says. A proposal nobody opened is a
    // proposal to chase, and it used to look identical to one they read.
    expect(viewLabel(summariseViews([]), NOW)).toBe("Not opened yet");
  });

  it("gives the count and the when together", () => {
    // Either alone misleads: six opens could be last month, and "2 hours
    // ago" could be the only time they ever looked.
    expect(viewLabel(summariseViews([row(120)]), NOW)).toBe("Opened once, 2 hours ago");
    expect(viewLabel(summariseViews([row(120), row(300)]), NOW)).toBe(
      "Opened 2 times, last 2 hours ago"
    );
  });

  it("uses no dashes", () => {
    expect(viewLabel(summariseViews([row(10), row(20)]), NOW)).not.toMatch(/[—–]/);
  });
});

describe("isWarm", () => {
  const keen = summariseViews([row(10), row(60), row(200), row(900)]);

  it("flags somebody who keeps coming back to an unanswered proposal", () => {
    expect(isWarm(keen, "sent")).toBe(true);
  });

  it("stays quiet on one or two looks", () => {
    expect(isWarm(summariseViews([row(10), row(60)]), "sent")).toBe(false);
    expect(isWarm(summariseViews([]), "sent")).toBe(false);
  });

  it("means nothing once they have answered", () => {
    // After accepting it is a receipt they keep reopening, not interest.
    expect(isWarm(keen, "accepted")).toBe(false);
    expect(isWarm(keen, "declined")).toBe(false);
    expect(isWarm(keen, "needs_approval")).toBe(false);
  });
});


describe("recent windows", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  const rows = [
    { viewedAt: "2026-08-29T11:40:00Z", visitorHash: "a" },
    { viewedAt: "2026-08-29T11:50:00Z", visitorHash: "a" },
    { viewedAt: "2026-08-29T04:00:00Z", visitorHash: "a" },
    { viewedAt: "2026-08-20T09:00:00Z", visitorHash: "b" },
  ];

  it("counts the last hour and the last day separately", () => {
    const summary = summariseViews(rows, now);
    expect(summary.inLastHour).toBe(2);
    expect(summary.inLastDay).toBe(3);
    expect(summary.opens).toBe(4);
  });

  it("ignores an unreadable timestamp rather than counting it as now", () => {
    const summary = summariseViews([{ viewedAt: "not a date", visitorHash: null }], now);
    expect(summary.inLastHour).toBe(0);
  });
});

describe("activityLabel", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  function summary(over: Partial<ViewSummary>): ViewSummary {
    return { opens: 1, people: 1, firstAt: null, lastAt: null, inLastHour: 0, inLastDay: 0, ...over };
  }

  it("leads with the last hour, which is somebody reading it now", () => {
    expect(activityLabel(summary({ opens: 5, inLastHour: 3, inLastDay: 5 }), now)).toBe(
      "Opened 3 times in the last hour"
    );
  });

  it("says so for a single open in the last hour", () => {
    expect(activityLabel(summary({ inLastHour: 1, inLastDay: 1 }), now)).toBe("Opened in the last hour");
  });

  it("falls back to today", () => {
    expect(activityLabel(summary({ opens: 4, inLastDay: 2 }), now)).toBe("Opened 2 times today");
    expect(activityLabel(summary({ inLastDay: 1 }), now)).toBe("Opened today");
  });

  it("falls back to the older wording when nothing is recent", () => {
    const older = summary({ opens: 3, lastAt: "2026-08-27T12:00:00Z" });
    expect(activityLabel(older, now)).toBe("Opened 3 times, last 2 days ago");
  });

  it("says plainly when it has never been opened", () => {
    expect(activityLabel(summary({ opens: 0 }), now)).toBe("Not opened yet");
  });
});

describe("isHot", () => {
  function summary(inLastHour: number): ViewSummary {
    return { opens: 1, people: 1, firstAt: null, lastAt: null, inLastHour, inLastDay: inLastHour };
  }

  it("is somebody on the page while a quote is out", () => {
    expect(isHot(summary(1), "sent")).toBe(true);
  });

  it("is not an accepted proposal being re-read as a receipt", () => {
    expect(isHot(summary(3), "accepted")).toBe(false);
  });

  it("is not a quote nobody has touched this hour", () => {
    expect(isHot(summary(0), "sent")).toBe(false);
  });
});

describe("watchingFor", () => {
  it("watches a quote that is out and unpaid", () => {
    expect(watchingFor("sent", null)).toBe(true);
  });

  it("stops once it is paid", () => {
    expect(watchingFor("sent", "2026-08-29T12:00:00Z")).toBe(false);
  });

  it("stops once it is answered", () => {
    expect(watchingFor("accepted", null)).toBe(false);
    expect(watchingFor("declined", null)).toBe(false);
    expect(watchingFor(null, null)).toBe(false);
  });
});

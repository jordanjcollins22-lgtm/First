import { describe, expect, it } from "vitest";

import { buildToday, isOnDay, localDayKey, withOwed, type TodayInput } from "@/lib/today";

function input(overrides: Partial<TodayInput> = {}): TodayInput {
  return { sold: [], money: [], visits: [], onSite: [], owed: 0, ...overrides };
}

const SALE = {
  jobId: "j1",
  customerName: "Pat Rivera",
  address: "208 Crafton Rd",
  value: 3_400,
  at: "2026-09-11T14:00:00Z",
};

describe("buildToday", () => {
  it("keeps what was sold apart from what was paid", () => {
    // Conflating them is how a good day on paper turns out to be a quote
    // somebody accepted and never paid for.
    const view = buildToday(
      input({
        sold: [SALE],
        money: [{ label: "Invoice 214", amount: 900, via: "Card", at: "2026-09-11T10:00:00Z" }],
      })
    );
    expect(view.soldValue).toBe(3_400);
    expect(view.moneyIn).toBe(900);
  });

  it("adds up several sales", () => {
    const view = buildToday(
      input({ sold: [SALE, { ...SALE, jobId: "j2", value: 1_200, at: "2026-09-11T09:00:00Z" }] })
    );
    expect(view.soldValue).toBe(4_600);
  });

  it("counts a sale with no total as a sale worth nothing, not as no sale", () => {
    const view = buildToday(input({ sold: [{ ...SALE, value: null }] }));
    expect(view.sold).toHaveLength(1);
    expect(view.soldValue).toBe(0);
  });

  it("puts the newest sale first and the earliest visit first", () => {
    // Sales read as a log of what just happened; visits read as a day to walk
    // through in order.
    const view = buildToday(
      input({
        sold: [SALE, { ...SALE, jobId: "j2", at: "2026-09-11T16:00:00Z" }],
        visits: [
          { jobId: "v2", customerName: "B", address: "b", at: "2026-09-11T15:00:00Z", status: "scheduled" },
          { jobId: "v1", customerName: "A", address: "a", at: "2026-09-11T09:00:00Z", status: "scheduled" },
        ],
      })
    );
    expect(view.sold[0].jobId).toBe("j2");
    expect(view.visits[0].jobId).toBe("v1");
  });
});

describe("the headline", () => {
  it("leads with money when money turned up", () => {
    const view = buildToday(
      input({
        sold: [SALE],
        money: [{ label: "Invoice 214", amount: 900, via: "Card", at: "2026-09-11T10:00:00Z" }],
      })
    );
    expect(view.headline).toBe("$900 in and $3,400 sold.");
  });

  it("says what was sold when nothing was collected", () => {
    expect(buildToday(input({ sold: [SALE] })).headline).toBe("One job sold, $3,400.");
  });

  it("does not dress up a day with nothing sold", () => {
    // Three visits and nothing sold should read as three visits and nothing
    // sold.
    const view = buildToday(
      input({
        visits: [
          { jobId: "v1", customerName: "A", address: "a", at: "2026-09-11T09:00:00Z", status: "scheduled" },
          { jobId: "v2", customerName: "B", address: "b", at: "2026-09-11T11:00:00Z", status: "scheduled" },
        ],
      })
    );
    expect(view.headline).toBe("2 visits booked, nothing sold yet.");
  });

  it("puts what is owed above what is merely booked", () => {
    const view = buildToday(
      input({
        owed: 3,
        visits: [{ jobId: "v1", customerName: "A", address: "a", at: "2026-09-11T09:00:00Z", status: "scheduled" }],
      })
    );
    expect(view.headline).toBe("Nothing sold today. 3 write-ups still owed.");
  });

  it("says a quiet day is quiet rather than showing empty headings", () => {
    const view = buildToday(input());
    expect(view.quiet).toBe(true);
    expect(view.headline).toBe("Nothing on today, and nothing owed.");
  });

  it("is not quiet when the crew is out, even with nothing sold", () => {
    const view = buildToday(
      input({ onSite: [{ jobId: "j9", customerName: "C", address: "c" }] })
    );
    expect(view.quiet).toBe(false);
    expect(view.headline).toBe("Crew is out, nothing sold today.");
  });
});

describe("isOnDay", () => {
  it("matches a timestamp to its own local day", () => {
    const noon = new Date(2026, 8, 11, 12, 0, 0);
    expect(isOnDay(noon.toISOString(), "2026-09-11")).toBe(true);
  });

  it("does not match yesterday", () => {
    const yesterday = new Date(2026, 8, 10, 12, 0, 0);
    expect(isOnDay(yesterday.toISOString(), "2026-09-11")).toBe(false);
  });

  it("says no to nothing and to nonsense", () => {
    expect(isOnDay(null, "2026-09-11")).toBe(false);
    expect(isOnDay("not a date", "2026-09-11")).toBe(false);
  });
});

describe("localDayKey", () => {
  it("pads a single-digit month and day", () => {
    expect(localDayKey(new Date(2026, 0, 5, 9, 0, 0))).toBe("2026-01-05");
  });

  it("reads the local calendar rather than UTC", () => {
    // An evening signature must not be dated to the following morning, which
    // is what reading the ISO string would do.
    const lateEvening = new Date(2026, 8, 11, 23, 30, 0);
    expect(localDayKey(lateEvening)).toBe("2026-09-11");
  });
});

describe("withOwed", () => {
  it("rewrites the headline rather than only the number", () => {
    // The count is worked out in parallel with the day, so it arrives after.
    // Setting it without rebuilding the sentence would leave a panel saying
    // "nothing sold today" above three write-ups nobody has done.
    const day = buildToday(input());
    const told = withOwed(day, 3);
    expect(told.owed).toBe(3);
    expect(told.headline).toBe("Nothing sold today. 3 write-ups still owed.");
  });

  it("leaves a day alone when the count has not changed", () => {
    const day = buildToday(input({ owed: 2 }));
    expect(withOwed(day, 2)).toBe(day);
  });

  it("does not overwrite a headline about money that came in", () => {
    const day = buildToday(
      input({ money: [{ label: "Invoice 9", amount: 500, via: "Card", at: "2026-09-11T10:00:00Z" }] })
    );
    expect(withOwed(day, 4).headline).toBe("$500 in today.");
  });
});

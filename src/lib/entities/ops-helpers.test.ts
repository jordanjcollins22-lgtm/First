import { describe, expect, it } from "vitest";

import {
  applicantMoves,
  cents,
  dayLabel,
  dollars,
  isDay,
  jobStatusMoves,
  outstandingLines,
  parseNumber,
  poActions,
  shiftSpan,
  shortPlace,
  spanLabel,
  splitResolution,
  toResult,
  attempt,
  parseCosts,
  words,
  workDayIsOpen,
} from "@/lib/entities/ops-helpers";

describe("formatting", () => {
  it("reads a bare date as a calendar day", () => {
    expect(dayLabel("2026-10-14")).toBe("Wed, Oct 14");
    expect(dayLabel(null)).toBe("—");
    expect(dayLabel("soon")).toBe("—");
  });

  it("shows one day alone and a span with both ends", () => {
    expect(spanLabel("2026-10-14", "2026-10-14")).toBe("Wed, Oct 14");
    expect(spanLabel("2026-10-13", "2026-10-15")).toBe("Tue, Oct 13 to Thu, Oct 15");
    expect(spanLabel(null, null)).toBe("—");
  });

  it("formats money from cents and from dollars", () => {
    expect(cents(123456)).toBe("$1,234.56");
    expect(cents(null)).toBe("—");
    expect(dollars(18.5)).toBe("$18.5");
    expect(dollars("")).toBe("—");
  });

  it("turns keys into words", () => {
    expect(words("in_progress")).toBe("In progress");
    expect(words("project-lead")).toBe("Project lead");
    expect(words(null)).toBe("—");
  });

  it("shortens an address to the street and town", () => {
    expect(shortPlace("12 Haystack Court, Forest Hill, Maryland 21050 — Estimate")).toBe("12 Haystack Court, Forest Hill");
    expect(shortPlace("Smith patio")).toBe("Smith patio");
  });
});

describe("reading what was typed", () => {
  it("parses numbers, blanks and nonsense", () => {
    expect(parseNumber("$1,200.50")).toBe(1200.5);
    expect(parseNumber("  ")).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber("lots")).toBeNaN();
  });

  it("accepts only real calendar days", () => {
    expect(isDay("2026-10-14")).toBe(true);
    expect(isDay("10/14/2026")).toBe(false);
    expect(isDay(undefined)).toBe(false);
  });

  it("splits a resolution from its prevention", () => {
    expect(splitResolution("Replaced the stone\nCheck pallets on delivery")).toEqual({
      resolution: "Replaced the stone",
      prevention: "Check pallets on delivery",
    });
    expect(splitResolution("Replaced it / Check on delivery")).toEqual({ resolution: "Replaced it", prevention: "Check on delivery" });
    expect(splitResolution("Replaced it")).toBeNull();
    expect(splitResolution("")).toBeNull();
  });
});

describe("job status moves", () => {
  it("never offers completed or cancelled, which have their own buttons", () => {
    expect(jobStatusMoves("approved")).toEqual(["estimating", "quoted", "in_progress"]);
    expect(jobStatusMoves("in_progress")).not.toContain("completed");
  });

  it("offers nothing on a closed job", () => {
    expect(jobStatusMoves("completed")).toEqual([]);
    expect(jobStatusMoves("cancelled")).toEqual([]);
  });
});

describe("work days", () => {
  it("knows which are still open", () => {
    expect(workDayIsOpen("scheduled")).toBe(true);
    expect(workDayIsOpen("paused")).toBe(true);
    expect(workDayIsOpen("done")).toBe(false);
    expect(workDayIsOpen("cancelled")).toBe(false);
  });

  it("keeps a visit's length when it moves", () => {
    expect(shiftSpan("2026-10-13", "2026-10-15", "2026-10-19")).toEqual({ start: "2026-10-19", end: "2026-10-21" });
    expect(shiftSpan("2026-10-13", "2026-10-13", "2026-11-02")).toEqual({ start: "2026-11-02", end: "2026-11-02" });
    expect(shiftSpan("2026-10-30", "2026-11-02", "2026-12-30")).toEqual({ start: "2026-12-30", end: "2027-01-02" });
  });
});

describe("purchase order buttons", () => {
  it("a draft with no supplier can only be ordered by hand or cancelled", () => {
    expect(poActions({ status: "draft", approvedAt: null, supplierId: null })).toEqual(["sent_by_hand", "cancel"]);
  });

  it("a draft with a supplier is approved, then sent", () => {
    expect(poActions({ status: "draft", approvedAt: null, supplierId: "s" })).toEqual(["approve", "sent_by_hand", "cancel"]);
    expect(poActions({ status: "draft", approvedAt: "2026-10-01", supplierId: "s" })).toEqual(["send", "sent_by_hand", "cancel"]);
  });

  it("a sent order is confirmed or received; a closed one has nothing", () => {
    expect(poActions({ status: "sent", approvedAt: "x", supplierId: "s" })).toEqual(["confirm", "receive", "cancel"]);
    expect(poActions({ status: "partial", approvedAt: "x", supplierId: "s" })).toEqual(["receive", "cancel"]);
    expect(poActions({ status: "delivered", approvedAt: "x", supplierId: "s" })).toEqual([]);
    expect(poActions({ status: "cancelled", approvedAt: null, supplierId: null })).toEqual([]);
  });

  it("receives only what is still to come", () => {
    expect(
      outstandingLines([
        { id: "a", quantity: 10, received: 4 },
        { id: "b", quantity: 2, received: 2 },
        { id: "c", quantity: 1.5, received: 0 },
      ])
    ).toEqual([
      { lineId: "a", quantity: 6 },
      { lineId: "c", quantity: 1.5 },
    ]);
  });
});

describe("applicants", () => {
  it("splits rejecting from advancing", () => {
    expect(applicantMoves(["interview", "not_a_fit"])).toEqual({ advance: ["interview"], reject: true });
    expect(applicantMoves(["not_a_fit", "withdrawn"])).toEqual({ advance: [], reject: true });
    expect(applicantMoves(["video_requested"])).toEqual({ advance: ["video_requested"], reject: false });
  });
});

describe("sign-off costs", () => {
  it("reads hours, materials and other from one box", () => {
    expect(parseCosts("32, 410, 25")).toEqual({ crewHours: 32, materialsDollars: 410, otherDollars: 25 });
    expect(parseCosts("12 $300")).toEqual({ crewHours: 12, materialsDollars: 300, otherDollars: 0 });
  });

  it("refuses too few numbers, negatives and words", () => {
    expect(parseCosts("12")).toBeNull();
    expect(parseCosts("12, -3")).toBeNull();
    expect(parseCosts("twelve, 3")).toBeNull();
    expect(parseCosts("")).toBeNull();
  });
});

describe("results", () => {
  it("reads every shape the actions answer in", () => {
    expect(toResult({ ok: true, message: "Moved." })).toEqual({ ok: true, message: "Moved." });
    expect(toResult({ ok: true, value: { id: "x" } }, "Done.")).toEqual({ ok: true, message: "Done." });
    expect(toResult({ ok: false, message: "No." })).toEqual({ ok: false, error: "No." });
    expect(toResult({ ok: false, error: "Nope." })).toEqual({ ok: false, error: "Nope." });
    expect(toResult(undefined, "Saved.")).toEqual({ ok: true, message: "Saved." });
  });

  it("turns a throw into an answer", async () => {
    expect(await attempt(async () => {}, "Saved.")).toEqual({ ok: true, message: "Saved." });
    expect(
      await attempt(async () => {
        throw new Error("Only admins can set pay.");
      }, "Saved.")
    ).toEqual({ ok: false, error: "Only admins can set pay." });
  });
});

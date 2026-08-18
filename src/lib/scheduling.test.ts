import { describe, expect, it } from "vitest";

import {
  DEFAULT_EVALUATION_MINUTES,
  evaluationMinutes,
  evaluationWindow,
  hasOutstandingWork,
  isTicketOpen,
  jobWindow,
  sessionsOnDate,
  validateAppointment,
  validateSession,
  windowsOverlap,
  type SessionShape,
} from "@/lib/scheduling";

function session(overrides: Partial<SessionShape> = {}): SessionShape {
  return { starts_on: "2026-09-01", ends_on: "2026-09-03", status: "scheduled", ...overrides };
}

describe("evaluationWindow", () => {
  it("uses the recorded end when there is one", () => {
    const w = evaluationWindow("2026-09-01T14:00:00Z", "2026-09-01T15:30:00Z")!;
    expect(w.end.toISOString()).toBe("2026-09-01T15:30:00.000Z");
  });

  it("falls back to the default length rather than inventing a stored one", () => {
    // Old rows genuinely don't know their length. The assumption lives in code
    // where it's visible, not in the database where it looks like a fact.
    const w = evaluationWindow("2026-09-01T14:00:00Z", null)!;
    expect(w.end.toISOString()).toBe("2026-09-01T15:00:00.000Z");
  });

  it("treats an end before its start as bad data, not a zero-length visit", () => {
    const w = evaluationWindow("2026-09-01T14:00:00Z", "2026-09-01T13:00:00Z")!;
    expect(w.end.getTime() - w.start.getTime()).toBe(DEFAULT_EVALUATION_MINUTES * 60_000);
  });

  it("returns nothing when no visit is booked", () => {
    expect(evaluationWindow(null, null)).toBeNull();
    expect(evaluationWindow(null, "2026-09-01T15:00:00Z")).toBeNull();
  });
});

describe("evaluationMinutes", () => {
  it("reports the real length", () => {
    expect(evaluationMinutes("2026-09-01T09:00:00Z", "2026-09-01T10:45:00Z")).toBe(105);
  });

  it("reports the default when none was recorded", () => {
    expect(evaluationMinutes("2026-09-01T09:00:00Z", null)).toBe(DEFAULT_EVALUATION_MINUTES);
  });

  it("reports nothing for an unbooked job", () => {
    expect(evaluationMinutes(null, null)).toBeNull();
  });
});

describe("windowsOverlap", () => {
  const w = (a: string, b: string) => ({ start: new Date(a), end: new Date(b) });

  it("catches a genuine double booking", () => {
    expect(
      windowsOverlap(w("2026-09-01T09:00Z", "2026-09-01T10:00Z"), w("2026-09-01T09:30Z", "2026-09-01T10:30Z"))
    ).toBe(true);
  });

  it("does not treat back-to-back visits as a clash", () => {
    // 10:00 finish and a 10:00 start is a full day, not a conflict.
    expect(
      windowsOverlap(w("2026-09-01T09:00Z", "2026-09-01T10:00Z"), w("2026-09-01T10:00Z", "2026-09-01T11:00Z"))
    ).toBe(false);
  });

  it("catches one visit sitting entirely inside another", () => {
    expect(
      windowsOverlap(w("2026-09-01T09:00Z", "2026-09-01T12:00Z"), w("2026-09-01T10:00Z", "2026-09-01T11:00Z"))
    ).toBe(true);
  });

  it("leaves separate days alone", () => {
    expect(
      windowsOverlap(w("2026-09-01T09:00Z", "2026-09-01T10:00Z"), w("2026-09-02T09:00Z", "2026-09-02T10:00Z"))
    ).toBe(false);
  });
});

describe("validateAppointment", () => {
  it("accepts a normal appointment", () => {
    expect(validateAppointment("2026-09-01T09:00:00Z", "2026-09-01T10:00:00Z").ok).toBe(true);
  });

  it("accepts a start with no end, since the default fills in", () => {
    expect(validateAppointment("2026-09-01T09:00:00Z", null).ok).toBe(true);
  });

  it("accepts clearing both, which unbooks the visit", () => {
    expect(validateAppointment(null, null).ok).toBe(true);
  });

  it("rejects an end with no start", () => {
    expect(validateAppointment(null, "2026-09-01T10:00:00Z").ok).toBe(false);
  });

  it("rejects an end at or before its start", () => {
    expect(validateAppointment("2026-09-01T10:00:00Z", "2026-09-01T09:00:00Z").ok).toBe(false);
    expect(validateAppointment("2026-09-01T10:00:00Z", "2026-09-01T10:00:00Z").ok).toBe(false);
  });

  it("rejects an absurd length, which is nearly always a wrong date", () => {
    const verdict = validateAppointment("2026-09-01T09:00:00Z", "2026-09-03T09:00:00Z");
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/12 hours/);
  });
});

describe("jobWindow", () => {
  it("spans from the earliest visit to the latest", () => {
    expect(
      jobWindow([
        session({ starts_on: "2026-09-10", ends_on: "2026-09-11" }),
        session({ starts_on: "2026-09-01", ends_on: "2026-09-03" }),
      ])
    ).toEqual({ start: "2026-09-01", end: "2026-09-11" });
  });

  it("ignores a cancelled visit, so a called-off trip doesn't stretch the job", () => {
    expect(
      jobWindow([
        session({ starts_on: "2026-09-01", ends_on: "2026-09-02" }),
        session({ starts_on: "2026-12-01", ends_on: "2026-12-02", status: "cancelled" }),
      ])
    ).toEqual({ start: "2026-09-01", end: "2026-09-02" });
  });

  it("counts a paused visit, because paused work is unfinished work", () => {
    expect(jobWindow([session({ status: "paused", starts_on: "2026-09-05", ends_on: "2026-09-06" })])).toEqual({
      start: "2026-09-05",
      end: "2026-09-06",
    });
  });

  it("has no window when every visit was cancelled", () => {
    expect(jobWindow([session({ status: "cancelled" })])).toBeNull();
  });

  it("has no window with no visits at all", () => {
    expect(jobWindow([])).toBeNull();
  });
});

describe("validateSession", () => {
  it("accepts a single day", () => {
    expect(validateSession("2026-09-01", "2026-09-01").ok).toBe(true);
  });

  it("rejects an end before its start", () => {
    expect(validateSession("2026-09-05", "2026-09-01").ok).toBe(false);
  });

  it("rejects a missing date", () => {
    expect(validateSession("", "2026-09-01").ok).toBe(false);
    expect(validateSession("2026-09-01", "").ok).toBe(false);
  });
});

describe("sessionsOnDate", () => {
  it("includes a day inside a visit's run", () => {
    expect(sessionsOnDate([session()], "2026-09-02")).toHaveLength(1);
  });

  it("includes both end days", () => {
    expect(sessionsOnDate([session()], "2026-09-01")).toHaveLength(1);
    expect(sessionsOnDate([session()], "2026-09-03")).toHaveLength(1);
  });

  it("excludes a day outside it", () => {
    expect(sessionsOnDate([session()], "2026-09-04")).toEqual([]);
  });

  it("keeps cancelled visits off the calendar", () => {
    expect(sessionsOnDate([session({ status: "cancelled" })], "2026-09-02")).toEqual([]);
  });
});

describe("hasOutstandingWork", () => {
  it("counts a paused visit as work still to do", () => {
    expect(hasOutstandingWork([session({ status: "paused" })])).toBe(true);
  });

  it("counts a scheduled visit", () => {
    expect(hasOutstandingWork([session({ status: "scheduled" })])).toBe(true);
  });

  it("is clear once every visit is done or cancelled", () => {
    expect(hasOutstandingWork([session({ status: "done" }), session({ status: "cancelled" })])).toBe(false);
  });

  it("is clear with no visits", () => {
    expect(hasOutstandingWork([])).toBe(false);
  });
});

describe("isTicketOpen", () => {
  it("counts open and booked tickets as needing something", () => {
    expect(isTicketOpen("open")).toBe(true);
    expect(isTicketOpen("scheduled")).toBe(true);
  });

  it("does not count finished ones", () => {
    expect(isTicketOpen("resolved")).toBe(false);
    expect(isTicketOpen("closed")).toBe(false);
  });
});

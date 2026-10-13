import { describe, expect, it } from "vitest";

import { finishVerdict, isBacklog, isUnclosedPastCutoff, type SessionLike } from "./session-close";

const session = (over: Partial<SessionLike> = {}): SessionLike => ({
  id: "s1",
  jobId: "j1",
  startsOn: "2026-10-13",
  endsOn: "2026-10-13",
  status: "scheduled",
  ...over,
});
const e = (profileId: string, kind: string) => ({ profileId, kind, at: "2026-10-13T15:00:00Z" });

describe("finishVerdict", () => {
  it("closes when the lead taps finished", () => {
    expect(finishVerdict(session(), "2026-10-13", [e("lead", "arrived_job"), e("tech", "arrived_job"), e("lead", "finished_job")], "lead")).toBe("close");
  });

  it("waits while somebody is still on site and the lead has not finished", () => {
    expect(finishVerdict(session(), "2026-10-13", [e("lead", "arrived_job"), e("tech", "arrived_job"), e("tech", "finished_job")], "lead")).toBe("wait");
  });

  it("closes when everyone who arrived has finished, with no lead tap", () => {
    expect(finishVerdict(session(), "2026-10-13", [e("a", "arrived_job"), e("b", "arrived_job"), e("a", "finished_job"), e("b", "finished_job")], null)).toBe("close");
  });

  it("only moves a multi-day visit to in progress before its last day", () => {
    const long = session({ endsOn: "2026-10-15" });
    expect(finishVerdict(long, "2026-10-13", [e("a", "arrived_job"), e("a", "finished_job")], "a")).toBe("in_progress");
    expect(finishVerdict(long, "2026-10-15", [e("a", "arrived_job"), e("a", "finished_job")], "a")).toBe("close");
  });

  it("ignores closed sessions and other days", () => {
    expect(finishVerdict(session({ status: "done" }), "2026-10-13", [e("a", "finished_job")], "a")).toBe("none");
    expect(finishVerdict(session(), "2026-10-14", [e("a", "finished_job")], "a")).toBe("none");
  });
});

describe("isUnclosedPastCutoff", () => {
  const live = { liveFromDay: "2026-10-01" };
  it("raises today's open session only after 9pm", () => {
    expect(isUnclosedPastCutoff(session(), "2026-10-13", 20 * 60 + 59, live)).toBe(false);
    expect(isUnclosedPastCutoff(session(), "2026-10-13", 21 * 60, live)).toBe(true);
  });
  it("raises a missed earlier day after go-live", () => {
    expect(isUnclosedPastCutoff(session({ endsOn: "2026-10-12" }), "2026-10-13", 9 * 60, live)).toBe(true);
  });
  it("never raises the backlog from before go-live", () => {
    expect(isUnclosedPastCutoff(session({ startsOn: "2026-09-02", endsOn: "2026-09-02" }), "2026-10-13", 22 * 60, live)).toBe(false);
    expect(isUnclosedPastCutoff(session(), "2026-10-13", 22 * 60, { liveFromDay: null })).toBe(false);
  });
  it("ignores closed sessions", () => {
    expect(isUnclosedPastCutoff(session({ status: "done" }), "2026-10-13", 22 * 60, live)).toBe(false);
  });
});

describe("isBacklog", () => {
  it("is the open past sessions from before go-live", () => {
    expect(isBacklog(session({ endsOn: "2026-09-02" }), "2026-10-13", "2026-10-01")).toBe(true);
    expect(isBacklog(session({ endsOn: "2026-10-05" }), "2026-10-13", "2026-10-01")).toBe(false);
    expect(isBacklog(session({ endsOn: "2026-10-13" }), "2026-10-13", null)).toBe(false);
    expect(isBacklog(session({ endsOn: "2026-10-12" }), "2026-10-13", null)).toBe(true);
  });
});

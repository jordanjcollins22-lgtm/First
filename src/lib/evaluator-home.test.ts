import { describe, expect, it } from "vitest";

import { backLabel, latestChecks, proposalOutcome, readReasons, safeBack, visitBackHref } from "@/lib/evaluator-home";

describe("visitBackHref", () => {
  it("sends an evaluator back to the new layout", () => {
    expect(visitBackHref(["evaluator"])).toBe("/v2/sales");
    expect(visitBackHref(["evaluator", "project-technician"])).toBe("/v2/sales");
  });
  it("keeps the owner on the old list of everybody's visits", () => {
    expect(visitBackHref(["owner"])).toBe("/evaluate");
    expect(visitBackHref([])).toBe("/evaluate");
  });
});

describe("safeBack", () => {
  it("allows the new layout and a visit", () => {
    expect(safeBack("/v2/sales")).toBe("/v2/sales");
    expect(safeBack("/evaluate/0b6f-12")).toBe("/evaluate/0b6f-12");
  });
  it("refuses anything else", () => {
    expect(safeBack(null)).toBeNull();
    expect(safeBack("https://evil.example")).toBeNull();
    expect(safeBack("//evil.example")).toBeNull();
    expect(safeBack("/admin/team")).toBeNull();
    expect(safeBack("/v2/sales/../admin")).toBeNull();
  });
  it("labels the way back", () => {
    expect(backLabel("/v2/sales")).toBe("Back to my day");
    expect(backLabel("/evaluate/x")).toBe("Back to the visit");
  });
});

describe("proposalOutcome", () => {
  it("is being priced before a proposal exists", () => {
    expect(proposalOutcome({ status: null, sentAt: null, check: null }).tone).toBe("waiting");
  });
  it("says sent once the client has it", () => {
    expect(proposalOutcome({ status: "sent", sentAt: "2026-10-13T12:00:00Z", check: null })).toMatchObject({ tone: "sent", label: "Priced and sent to the client" });
    expect(proposalOutcome({ status: "sent", sentAt: null, check: null }).label).toBe("Priced and approved");
  });
  it("says held, and why", () => {
    const o = proposalOutcome({ status: "needs_approval", sentAt: null, check: { action: "hold", reasons: ["Margin 30% is under the 40% target."] } });
    expect(o.tone).toBe("held");
    expect(o.why).toContain("Margin 30%");
  });
  it("gives a reason even when the check gave none", () => {
    expect(proposalOutcome({ status: "needs_approval", sentAt: null, check: { action: "hold", reasons: [] } }).why).toBeTruthy();
  });
  it("waits on the office when nothing held it", () => {
    expect(proposalOutcome({ status: "needs_approval", sentAt: null, check: null }).tone).toBe("waiting");
  });
  it("knows won and lost", () => {
    expect(proposalOutcome({ status: "accepted", sentAt: null, check: null }).tone).toBe("won");
    expect(proposalOutcome({ status: "declined", sentAt: null, check: null }).tone).toBe("lost");
  });
});

describe("latestChecks", () => {
  it("keeps the newest check per job", () => {
    const m = latestChecks([
      { job_id: "a", checked_at: "2026-10-01T00:00:00Z", action: "hold" },
      { job_id: "a", checked_at: "2026-10-02T00:00:00Z", action: "approve_and_send" },
      { job_id: "b", checked_at: "2026-10-01T00:00:00Z", action: "hold" },
    ]);
    expect(m.get("a")?.action).toBe("approve_and_send");
    expect(m.get("b")?.action).toBe("hold");
  });
  it("reads stored reasons", () => {
    expect(readReasons(["x", 3, "y"])).toEqual(["x", "y"]);
    expect(readReasons(null)).toEqual([]);
  });
});

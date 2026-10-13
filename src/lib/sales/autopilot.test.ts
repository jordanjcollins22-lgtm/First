import { describe, expect, it } from "vitest";

import { DEFAULT_AUTOPILOT, afterGoLive, decide, goLiveAfterSave, readAutopilot, sendKey, type ProposalFacts } from "@/lib/sales/autopilot";
import { formatHours, hoursToProposal, isOverdue, median, speedSummary } from "@/lib/sales/speed-to-proposal";

const live = { ...DEFAULT_AUTOPILOT, startedAt: "2026-10-01T12:00:00.000Z" };
const facts = (over: Partial<ProposalFacts> = {}): ProposalFacts => ({
  status: "needs_approval",
  submittedAt: "2026-10-13T15:00:00.000Z",
  sentAt: null,
  passes: true,
  hasEmail: true,
  ...over,
});

describe("the autopilot's decision", () => {
  it("approves and sends a proposal inside the guardrails", () => {
    expect(decide(live, facts()).kind).toBe("approve_and_send");
  });

  it("holds one outside them", () => {
    expect(decide(live, facts({ passes: false })).kind).toBe("hold");
  });

  it("never touches anything submitted before it went live: no backlog blast", () => {
    const action = decide(live, facts({ submittedAt: "2026-09-30T12:00:00.000Z" }));
    expect(action.kind).toBe("ignore");
    expect(action.why).toMatch(/before the autopilot went live/);
  });

  it("does nothing until it has a go-live moment", () => {
    expect(decide({ ...live, startedAt: null }, facts()).kind).toBe("ignore");
  });

  it("does nothing with auto-approve off", () => {
    expect(decide({ ...live, autoApprove: false }, facts()).kind).toBe("ignore");
  });

  it("approves without sending when auto-send is off or there is no email", () => {
    expect(decide({ ...live, autoSend: false }, facts()).kind).toBe("approve");
    const noEmail = decide(live, facts({ hasEmail: false }));
    expect(noEmail.kind).toBe("approve");
    expect(noEmail.why).toMatch(/no email/);
  });

  it("leaves a proposal alone once it is no longer waiting", () => {
    expect(decide(live, facts({ status: "sent" })).kind).toBe("ignore");
  });

  it("keys the send on the draft so it can never go twice", () => {
    expect(sendKey("job-1", "2026-10-13T15:00:00.000Z")).toBe(sendKey("job-1", "2026-10-13T15:00:00.000Z"));
    expect(sendKey("job-1", "a")).not.toBe(sendKey("job-1", "b"));
  });

  it("goes live once and keeps that moment", () => {
    const now = new Date("2026-10-13T10:00:00.000Z");
    expect(goLiveAfterSave(null, true, now)).toBe(now.toISOString());
    expect(goLiveAfterSave("2026-01-01T00:00:00.000Z", true, now)).toBe("2026-01-01T00:00:00.000Z");
    expect(goLiveAfterSave(null, false, now)).toBeNull();
    expect(afterGoLive("2026-10-13T10:00:00.000Z", "2026-10-13T10:00:00.000Z")).toBe(true);
  });

  it("reads the stored row with defaults for anything missing", () => {
    const settings = readAutopilot({ auto_send: false, margin_install: 0.28, formula_tolerance: 9, mhic_license: "  " });
    expect(settings.autoSend).toBe(false);
    expect(settings.autoApprove).toBe(true);
    expect(settings.targets.install).toBe(0.28);
    expect(settings.targets.maintenance).toBe(0.5);
    expect(settings.tolerance).toBe(0.15);
    expect(settings.mhicLicense).toBeNull();
    expect(readAutopilot(null)).toEqual(DEFAULT_AUTOPILOT);
  });
});

describe("speed to proposal", () => {
  const now = new Date("2026-10-13T20:00:00.000Z");

  it("counts hours from submitted to sent", () => {
    expect(hoursToProposal("2026-10-13T15:00:00.000Z", "2026-10-13T16:30:00.000Z")).toBe(1.5);
    expect(hoursToProposal("2026-10-13T15:00:00.000Z", null)).toBeNull();
    expect(hoursToProposal("2026-10-13T15:00:00.000Z", "2026-10-13T14:00:00.000Z")).toBeNull();
  });

  it("is overdue past two hours unsent, and never once sent", () => {
    expect(isOverdue("2026-10-13T17:30:00.000Z", null, now)).toBe(true);
    expect(isOverdue("2026-10-13T18:30:00.000Z", null, now)).toBe(false);
    expect(isOverdue("2026-10-13T10:00:00.000Z", "2026-10-13T19:00:00.000Z", now)).toBe(false);
    expect(isOverdue(null, null, now)).toBe(false);
  });

  it("summarises median, within target, same day and overdue", () => {
    const summary = speedSummary(
      [
        { submittedAt: "2026-10-13T13:00:00.000Z", sentAt: "2026-10-13T14:00:00.000Z" },
        { submittedAt: "2026-10-13T13:00:00.000Z", sentAt: "2026-10-13T16:00:00.000Z" },
        // Sent the next morning in Maryland.
        { submittedAt: "2026-10-12T21:00:00.000Z", sentAt: "2026-10-13T13:00:00.000Z" },
        { submittedAt: "2026-10-13T12:00:00.000Z", sentAt: null },
      ],
      now
    );
    expect(summary.sent).toBe(3);
    expect(summary.medianHours).toBe(3);
    expect(summary.withinTarget).toBeCloseTo(1 / 3);
    expect(summary.sameDay).toBeCloseTo(2 / 3);
    expect(summary.overdue).toBe(1);
  });

  it("has a median and a short format", () => {
    expect(median([])).toBeNull();
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(formatHours(0.25)).toBe("15 min");
    expect(formatHours(1.25)).toBe("1.3 h");
    expect(formatHours(72)).toBe("3 days");
    expect(formatHours(null)).toBe("—");
  });
});

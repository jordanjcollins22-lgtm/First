import { describe, expect, it } from "vitest";

import type { SequenceMessage } from "@/lib/client-message-sequence";
import { dueAt, sequenceKeyFromDedupe, stageRoster } from "@/lib/stage-roster";

const msg = (key: string, number: string, over: Partial<SequenceMessage> = {}): SequenceMessage => ({
  key,
  number,
  moment: key,
  square: "booking",
  stage: "evaluation",
  title: key,
  when: "",
  channel: key.endsWith("-sms") ? "sms" : "email",
  on: true,
  byHand: false,
  heldForOk: false,
  subject: "",
  body: "",
  note: null,
  ...over,
});

describe("sequenceKeyFromDedupe", () => {
  it("reads every kind of sent message", () => {
    expect(sequenceKeyFromDedupe("evaluation_sequence:j1:two_days:email")).toBe("evaluation-two_days");
    expect(sequenceKeyFromDedupe("evaluation_confirmed:j1:0:sms")).toBe("evaluation_confirmed-0-sms");
    expect(sequenceKeyFromDedupe("job_start_reminder:j1:-18:sms")).toBe("job_start_reminder--18-sms");
    expect(sequenceKeyFromDedupe("proposal_follow_up:p1:72:email")).toBe("proposal_follow_up-72-email");
    expect(sequenceKeyFromDedupe("proposal_ready:j1:2026-10-03T20:22:36.635Z:send:1")).toBe("proposal-ready");
    expect(sequenceKeyFromDedupe("pre_eval_ask:j1:2026-10-01")).toBeNull();
  });
});

describe("dueAt", () => {
  const anchors = { bookedAt: "2026-10-01T12:00:00Z", visitAt: "2026-10-06T14:00:00Z", proposalSentAt: "2026-10-02T12:00:00Z", jobStartAt: "2026-10-10T12:00:00Z" };
  it("counts each message from its own date", () => {
    expect(dueAt("evaluation-booked", anchors)).toBe("2026-10-01T12:00:00Z");
    expect(dueAt("evaluation-two_days", anchors)).toBe("2026-10-04T14:00:00.000Z");
    expect(dueAt("evaluation_reminder--18-sms", anchors)).toBe("2026-10-05T20:00:00.000Z");
    expect(dueAt("proposal_follow_up-72-email", anchors)).toBe("2026-10-05T12:00:00.000Z");
    expect(dueAt("job_start_reminder--18-sms", anchors)).toBe("2026-10-09T18:00:00.000Z");
  });
});

describe("stageRoster", () => {
  const messages = [msg("evaluation-booked", "1.1"), msg("evaluation-two_days", "1.2"), msg("evaluation-day_before", "1.3"), msg("evaluation-morning_of", "1.4", { on: false })];
  const now = new Date("2026-10-04T20:00:00Z");

  it("says what they had last and what is next, skipping what is switched off or past", () => {
    const [row] = stageRoster(
      messages,
      [{ jobId: "j", client: "Sample", anchors: { bookedAt: "2026-10-01T12:00:00Z", visitAt: "2026-10-06T14:00:00Z" }, sent: new Map([["evaluation-booked", "2026-10-01T12:01:00Z"]]) }],
      now
    );
    expect(row.had?.number).toBe("1.1");
    // Two days before was 2026-10-04 14:00, already past at 20:00; the evening before is next.
    expect(row.next?.number).toBe("1.3");
  });

  it("has nothing next once every message here has gone", () => {
    const sent = new Map(messages.map((m) => [m.key, "2026-10-01T12:00:00Z"]));
    const [row] = stageRoster(messages, [{ jobId: "j", client: "Sample", anchors: { visitAt: "2026-10-06T14:00:00Z" }, sent }], now);
    expect(row.next).toBeNull();
  });
});

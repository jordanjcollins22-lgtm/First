import { describe, expect, it } from "vitest";

import { buildMessageSequence } from "@/lib/client-message-sequence";
import { DEFAULT_RULES } from "@/lib/client-reminders";
import { SAMPLE_VARS, type SequenceStep } from "@/lib/evaluation-sequence";

const step = (key: SequenceStep["step"], ordinal: number, enabled = true): SequenceStep => ({
  step: key,
  ordinal,
  label: key,
  timing: "sometime",
  enabled,
  subject: "Hi {first_name}",
  body: "See you {when}",
  custom: false,
  updatedAt: null,
});

const input = {
  businessName: "JS Landscaping MD",
  steps: [step("after", 5), step("booked", 1), step("two_days", 2, false), step("day_before", 3)],
  rules: DEFAULT_RULES,
  remindersOn: true,
  approvalRequired: false,
  vars: SAMPLE_VARS,
  sample: { clientName: "Sarah Miller", address: "12 Example Court, Bel Air", evaluator: "Jordan", manager: "Jace", baseUrl: "https://app.example.com" },
};

describe("the client's messages, in order", () => {
  const all = buildMessageSequence(input);

  it("numbers each moment, with its text before its email", () => {
    const booked = all.filter((m) => m.moment === "Evaluation booked");
    expect(booked.map((m) => [m.number, m.channel])).toEqual([
      ["1.1", "sms"],
      ["1.2", "email"],
    ]);
    // The rule's own email is the old version of the evaluation email, so only its text is kept.
    expect(booked[1].key).toBe("evaluation-booked");
    const eveningBefore = all.filter((m) => m.key === "evaluation_reminder--18-sms" || m.key === "evaluation-day_before");
    expect(new Set(eveningBefore.map((m) => m.moment)).size).toBe(1);
    expect(all.map((m) => m.number)).toContain("2.1");
  });

  it("runs evaluation, proposal, job, invoice", () => {
    const stages = all.map((m) => m.stage);
    const order = ["evaluation", "proposal", "job", "invoice"];
    expect([...stages].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(stages);
    expect(all[1].key).toBe("evaluation-booked");
    expect(all[1].subject).toBe("Hi Deanna");
  });

  it("says which are switched off, and texts only where a rule sends texts", () => {
    expect(all.find((m) => m.key === "evaluation-two_days")?.on).toBe(false);
    expect(all.find((m) => m.key === "proposal_follow_up-72-sms")?.on).toBe(false);
    expect(all.find((m) => m.key === "proposal_follow_up-72-email")?.on).toBe(true);
    expect(all.find((m) => m.key === "job_start_reminder--18-sms")?.when).toBe("The evening before the job");
    expect(all.find((m) => m.key === "proposal_follow_up-72-email")?.when).toBe("3 days after the proposal is sent, if they haven't answered");
  });

  it("owns up that invoice reminders don't go yet", () => {
    const invoice = all.find((m) => m.key === "invoice_reminder-168-email")!;
    expect(invoice.on).toBe(false);
    expect(invoice.note).toMatch(/nothing sends/);
  });

  it("holds the proposal for the owner's OK", () => {
    expect(all.find((m) => m.key === "proposal-ready")?.heldForOk).toBe(true);
  });
});

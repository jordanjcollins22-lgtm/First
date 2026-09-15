import { describe, expect, it } from "vitest";

import {
  describeSequence,
  isSequenceStep,
  renderTemplate,
  SAMPLE_VARS,
  unknownPlaceholders,
  validateStep,
  type SequenceStep,
} from "@/lib/evaluation-sequence";

function step(overrides: Partial<SequenceStep> = {}): SequenceStep {
  return {
    step: "booked",
    ordinal: 1,
    label: "Booked",
    timing: "Right after they book",
    enabled: true,
    subject: "You are booked: {day} {date} at {time}",
    body: "Hi {first_name}, see you {when} at {address}.",
    custom: false,
    updatedAt: null,
    ...overrides,
  };
}

describe("renderTemplate", () => {
  it("fills every brace, more than once, and leaves unknown ones alone", () => {
    expect(renderTemplate("Hi {first_name}, {first_name}. {mystery}", { first_name: "Deanna" })).toBe(
      "Hi Deanna, Deanna. {mystery}"
    );
  });

  it("renders the sample the way the database would", () => {
    expect(renderTemplate(step().body, SAMPLE_VARS)).toBe(
      "Hi Deanna, see you Thursday, September 17 at 9:00 am at 1613 Bimini Drive, Bel Air."
    );
  });
});

describe("validateStep", () => {
  it("refuses a placeholder nothing fills in", () => {
    expect(validateStep({ subject: "Hi {name}", body: "ok" })).toMatch(/\{name\}/);
    expect(unknownPlaceholders("{first_name} {nme}")).toEqual(["nme"]);
  });

  it("accepts the defaults", () => {
    expect(validateStep({ subject: step().subject, body: step().body })).toBeNull();
    expect(validateStep({ subject: " ", body: "x" })).toMatch(/subject/);
  });
});

describe("the sequence at a glance", () => {
  it("says how many are on", () => {
    const steps = [step(), step({ step: "after", enabled: false })];
    expect(describeSequence(steps)).toBe("1 of 2 emails switched on.");
    expect(describeSequence(steps.map((s) => ({ ...s, enabled: true })))).toBe("2 emails, all switched on.");
    expect(isSequenceStep("morning_of")).toBe(true);
    expect(isSequenceStep("noon")).toBe(false);
  });
});

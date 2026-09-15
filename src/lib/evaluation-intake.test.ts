import { describe, expect, it } from "vitest";

import {
  answeredCount,
  cleanAnswers,
  emptyAnswers,
  INTAKE_QUESTIONS,
  intakeHeadline,
  summarizeIntake,
  talkingPoints,
} from "@/lib/evaluation-intake";

describe("cleanAnswers", () => {
  it("keeps only the options we offered and trims the text", () => {
    const cleaned = cleanAnswers({
      services: ["beds", "beds", "nonsense", 42],
      services_other: "  a fire pit  ",
      budget: "made_up",
      timing: "asap",
      tried: "x".repeat(5000),
      extra: "dropped",
    });
    expect(cleaned.services).toEqual(["beds"]);
    expect(cleaned.services_other).toBe("a fire pit");
    expect(cleaned.budget).toBe("");
    expect(cleaned.timing).toBe("asap");
    expect(cleaned.tried).toHaveLength(2000);
    expect("extra" in cleaned).toBe(false);
  });

  it("makes something sensible out of nothing", () => {
    expect(cleanAnswers(null)).toEqual(emptyAnswers());
    expect(answeredCount(emptyAnswers())).toBe(0);
  });
});

describe("what the evaluator reads", () => {
  const answers = cleanAnswers({
    services: ["beds", "mulch"],
    areas: ["front"],
    looks: ["unsure"],
    concerns: ["price", "other_quotes"],
    concerns_notes: "Last quote was 9k",
    budget: "2500_5000",
    decision: "partner",
    tried: "Planted boxwoods, they died",
  });

  it("summarises every answered question with the labels, not the codes", () => {
    const lines = summarizeIntake(answers);
    expect(lines.map((l) => l.label)).toEqual(["Wants", "Where", "Looks", "Tried before", "Would say no over", "Budget", "Decides"]);
    expect(lines[0].value).toBe("Landscape beds and plantings, Mulch or stone in the beds");
    expect(lines[4].value).toBe("The price, Getting other quotes. Last quote was 9k");
    expect(answeredCount(answers)).toBe(7);
  });

  it("turns each concern into something to do on the walk", () => {
    const points = talkingPoints(answers);
    expect(points[0]).toMatch(/\$2,500 to \$5,000/);
    expect(points.some((p) => p.includes("other quotes"))).toBe(true);
    expect(points.some((p) => p.includes("Somebody else has a say"))).toBe(true);
    expect(points.some((p) => p.includes("boxwoods"))).toBe(true);
    expect(points.some((p) => p.includes("three planting palettes"))).toBe(true);
  });

  it("says what to do when nothing came back", () => {
    expect(intakeHeadline(null, null)).toMatch(/first 5 to 10 minutes/);
    expect(intakeHeadline(answers, "2026-09-14T10:00:00Z")).toBe(
      "Landscape beds and plantings, Mulch or stone in the beds · $2,500 to $5,000"
    );
  });

  it("asks the things the owner asked for", () => {
    const titles = INTAKE_QUESTIONS.map((q) => q.title.toLowerCase());
    expect(titles.some((t) => t.includes("colours"))).toBe(true);
    expect(titles.some((t) => t.includes("tried"))).toBe(true);
    expect(titles.some((t) => t.includes("say no"))).toBe(true);
    expect(titles.some((t) => t.includes("ask us"))).toBe(true);
  });
});

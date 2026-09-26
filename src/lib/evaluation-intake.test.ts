import { describe, expect, it } from "vitest";

import {
  answeredCount,
  answersForConcerns,
  BEFORE_VISIT_QUESTIONS,
  CONCERN_ANSWERS,
  detailQuestionsFor,
  summarizeDetails,
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

describe("the details that set the price", () => {
  it("asks only about the work they ticked, then about the property", () => {
    const ids = detailQuestionsFor(["removal"]).map((q) => q.id);
    expect(ids).toContain("stumps");
    expect(ids).not.toContain("cover");
    expect(ids).toContain("gate");
    expect(detailQuestionsFor([]).every((q) => q.services === null)).toBe(true);
  });

  it("keeps offered answers only, and reads them back in words", () => {
    const answers = cleanAnswers({
      services: ["removal"],
      details: { stumps: "12_24", gate: "narrow", buried: ["sprinklers", "made_up"], cover: "purple", nonsense: "x" },
    });
    expect(answers.details).toEqual({ stumps: "12_24", gate: "narrow", buried: ["sprinklers"] });
    expect(summarizeDetails(answers)).toEqual([
      { label: "Stumps", value: "1 to 2 feet across" },
      { label: "Way in", value: "Under 3 ft" },
      { label: "Buried", value: "Sprinklers" },
    ]);
    const points = talkingPoints(answers);
    expect(points.some((p) => p.includes("hand work"))).toBe(true);
    expect(points.some((p) => p.includes("sprinkler heads"))).toBe(true);
    expect(points.some((p) => p.includes("Big stumps"))).toBe(true);
  });

  it("keeps only photo paths the form could have made", () => {
    const answers = cleanAnswers({
      photos: ["0b9c-11/intake-4f2a.jpg", "0b9c-11/intake-4f2a.jpg", "../other/secret.jpg", "0b9c-11/photo.jpg", 7],
    });
    expect(answers.photos).toEqual(["0b9c-11/intake-4f2a.jpg"]);
  });
});

describe("answering what would make them say no", () => {
  it("has an answer for every worry but being ready", () => {
    const concerns = INTAKE_QUESTIONS.find((q) => q.key === "concerns")!.options!.map((o) => o.value);
    for (const c of concerns.filter((c) => c !== "nothing")) {
      expect(CONCERN_ANSWERS[c]?.length, c).toBeGreaterThan(0);
      expect(answersForConcerns([c]).every((a) => a.body.length > 40), c).toBe(true);
    }
    expect(answersForConcerns(["nothing"])).toEqual([]);
  });

  it("says each answer once however many worries share it", () => {
    const headings = answersForConcerns(["price", "bad_experience", "price"]).map((a) => a.heading);
    expect(new Set(headings).size).toBe(headings.length);
  });

  it("answers the usual questions in plain words, with no dashes", () => {
    expect(BEFORE_VISIT_QUESTIONS.length).toBeGreaterThanOrEqual(6);
    for (const a of [...BEFORE_VISIT_QUESTIONS, ...Object.values(CONCERN_ANSWERS).flat()]) {
      expect(a.body).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

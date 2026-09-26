import { describe, expect, it } from "vitest";

import {
  answeredCount,
  answersForConcerns,
  BEFORE_VISIT_QUESTIONS,
  CONCERN_ANSWERS,
  DETAIL_QUESTIONS,
  detailQuestionsFor,
  notesShown,
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
    expect(lines.map((l) => l.label)).toEqual(["Wants", "Where", "Looks", "Worried about", "Budget", "Decides"]);
    expect(lines[0].value).toBe("Beds: mulch, stone or plants");
    expect(lines[3].value).toBe("The price, Getting other quotes. Planted boxwoods, they died. Last quote was 9k");
    expect(answeredCount(answers)).toBe(6);
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
    expect(intakeHeadline(emptyAnswers(), null)).toMatch(/first 5 to 10 minutes/);
    expect(intakeHeadline(answers, null)).toBe("Started, not sent: 6 answered. Finish it together at the door.");
    expect(intakeHeadline(answers, "2026-09-14T10:00:00Z")).toBe(
      "Beds: mulch, stone or plants · $2,500 to $5,000"
    );
  });

  it("asks the things the owner asked for", () => {
    const titles = INTAKE_QUESTIONS.map((q) => q.title.toLowerCase());
    expect(titles.some((t) => t.includes("colours"))).toBe(true);
    // Tried before is asked on the say-no page, in its box.
    expect(INTAKE_QUESTIONS.find((q) => q.key === "concerns")?.notesKey).toBe("tried");
    expect(titles.some((t) => t.includes("worried about"))).toBe(true);
    expect(titles.some((t) => t.includes("say no"))).toBe(false);
    expect(titles.some((t) => t.includes("ask us"))).toBe(true);
  });
});

describe("the details that set the price", () => {
  it("asks only about the work they ticked, then about the property", () => {
    const ids = detailQuestionsFor(["removal"]).map((q) => q.id);
    expect(ids).toEqual(["remove_what", "yard"]);
    expect(detailQuestionsFor([]).map((q) => q.id)).toEqual(["yard"]);
  });

  it("asks no more than two things about any one kind of work", () => {
    const services = INTAKE_QUESTIONS[0].options!.map((o) => o.value);
    for (const s of services) expect(detailQuestionsFor([s]).filter((q) => q.services !== null).length, s).toBeLessThanOrEqual(2);
  });

  it("asks sod or seed only when the lawn is being repaired", () => {
    expect(detailQuestionsFor(["lawn"], { lawn_need: ["mowing"] }).map((q) => q.id)).not.toContain("lawn_method");
    expect(detailQuestionsFor(["lawn"], { lawn_need: ["patch"] }).map((q) => q.id)).toContain("lawn_method");
  });

  it("reads old answers from before the services were merged", () => {
    expect(cleanAnswers({ services: ["mulch", "beds", "trimming", "lawn_care", "lighting"] }).services).toEqual(["beds", "cleanup", "lawn", "other"]);
  });

  it("keeps offered answers only, and reads them back in words", () => {
    const answers = cleanAnswers({
      services: ["removal"],
      details: { remove_what: ["roots", "made_up"], yard: ["narrow_gate", "sprinklers"], yard_notes: " code 1234 ", cover: "purple" },
    });
    expect(answers.details).toEqual({ remove_what: ["roots"], yard: ["narrow_gate", "sprinklers"], yard_notes: "code 1234" });
    expect(summarizeDetails(answers)).toEqual([
      { label: "Removing", value: "Old roots to dig out" },
      { label: "Yard", value: "Gate under 3 ft wide, Sprinklers. code 1234" },
    ]);
    const points = talkingPoints(answers);
    expect(points.some((p) => p.includes("hand work"))).toBe(true);
    expect(points.some((p) => p.includes("sprinkler heads"))).toBe(true);
    expect(points.some((p) => p.includes("Old roots"))).toBe(true);
  });

  it("shows a notes box only once it is needed", () => {
    const services = INTAKE_QUESTIONS[0];
    expect(notesShown(services, cleanAnswers({ services: ["beds"] }))).toBe(false);
    expect(notesShown(services, cleanAnswers({ services: ["other"] }))).toBe(true);
    expect(notesShown(services, cleanAnswers({ services: ["beds"], services_other: "a fire pit" }))).toBe(true);
  });

  it("never offers tree or stump work, which the business does not do itself", () => {
    const words = [...INTAKE_QUESTIONS, ...DETAIL_QUESTIONS].flatMap((q) => [q.title, ...(q.options ?? []).map((o) => o.label)]).join(" ");
    expect(words).not.toMatch(/stump|\btrees?\b/i);
  });

  it("keeps only photo paths the form could have made", () => {
    const answers = cleanAnswers({
      photos: ["0b9c-11/intake-4f2a.jpg", "0b9c-11/intake-4f2a.jpg", "../other/secret.jpg", "0b9c-11/photo.jpg", 7],
    });
    expect(answers.photos).toEqual(["0b9c-11/intake-4f2a.jpg"]);
  });
});

describe("answering what they are worried about", () => {
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
      // Only what is known to be true: no claims about licences, insurance or guarantees.
      expect(`${a.heading} ${a.body}`).not.toMatch(/licen[cs]|insur|warrant|guarantee/i);
    }
  });
});

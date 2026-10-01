import { describe, expect, it } from "vitest";

import {
  areaOptionsFor,
  isGrounds,
  photoAreasFor,
  answeredCount,
  answersForConcerns,
  asksForPeople,
  asksLooks,
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
    expect(titles.some((t) => t.includes("concerned about"))).toBe(true);
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
    // Follow-ups that only appear after an answer (which mulch, sod or seed) are not counted.
    for (const s of services) expect(detailQuestionsFor([s]).filter((q) => q.services !== null && !q.showIf).length, s).toBeLessThanOrEqual(2);
  });

  it("asks which mulch or rock only once they pick it, with a photo of each", () => {
    expect(detailQuestionsFor(["beds"], { beds_add: ["plants"] }).map((q) => q.id)).toEqual(["beds_now", "beds_add", "yard"]);
    expect(detailQuestionsFor(["beds"], { beds_add: ["mulch", "stone"] }).map((q) => q.id)).toEqual(["beds_now", "beds_add", "mulch_color", "bed_stone", "yard"]);
    const mulch = DETAIL_QUESTIONS.find((q) => q.id === "mulch_color")!;
    expect(mulch.options!.filter((o) => o.image).map((o) => o.label)).toEqual(["Brown", "Black", "Natural"]);
    const stone = DETAIL_QUESTIONS.find((q) => q.id === "bed_stone")!;
    expect(stone.options!.every((o) => o.value === "unsure" || /river-rock/.test(o.image ?? ""))).toBe(true);
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
    // Lights on a tree are decorating, not tree work, so that group is left out.
    const work = DETAIL_QUESTIONS.filter((q) => q.group !== "Holiday decorations");
    const words = [...INTAKE_QUESTIONS, ...work].flatMap((q) => [q.title, ...(q.options ?? []).map((o) => o.label)]).join(" ");
    expect(words).not.toMatch(/stump|\btrees?\b/i);
  });

  it("keeps only photo paths the form could have made", () => {
    const answers = cleanAnswers({
      photos: ["0b9c-11/intake-4f2a.jpg", "0b9c-11/intake-4f2a.jpg", "../other/secret.jpg", "0b9c-11/photo.jpg", 7],
    });
    expect(answers.photos).toEqual(["0b9c-11/intake-4f2a.jpg"]);
  });
});

describe("who else is in the decision", () => {
  it("has just me, me and others, and an HOA, and reads older answers as one of them", () => {
    expect(INTAKE_QUESTIONS.find((q) => q.key === "decision")!.options!.map((o) => o.label)).toEqual(["Just me", "Me and others", "An HOA"]);
    expect(cleanAnswers({ decision: "partner" }).decision).toBe("others");
    expect(cleanAnswers({ decision: "family" }).decision).toBe("others");
  });

  it("asks who and how to reach them only when somebody else has a say", () => {
    expect(asksForPeople("me")).toBe(false);
    expect(asksForPeople("others")).toBe(true);
    expect(asksForPeople("hoa")).toBe(true);
  });

  it("keeps each person's name, who they are and contact, and drops empty rows", () => {
    const answers = cleanAnswers({
      decision: "others",
      people: [{ name: " Mike ", role: "Husband", contact: "410 555 0100" }, { name: "", role: "Mom", contact: "" }, "junk"],
    });
    // Nobody said what Mike should see, so he gets the plan only.
    expect(answers.people).toEqual([{ name: "Mike", role: "Husband", contact: "410 555 0100", sees: "scope" }]);
    expect(summarizeIntake(answers)).toContainEqual({ label: "Husband", value: "Mike, 410 555 0100, send the plan only" });
    expect(talkingPoints(answers).some((p) => p.includes("Mike (Husband) also has a say"))).toBe(true);
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

  it("says what the owner asked it to say", () => {
    const faq = (h: string) => BEFORE_VISIT_QUESTIONS.find((a) => a.heading === h)!.body;
    expect(faq("Can I add something later?")).toMatch(/^As long as it is added before we start the work/);
    expect(faq("What happens if the weather is bad?")).toMatch(/^Any weather can push the schedule back/);
    expect(CONCERN_ANSWERS.hoa[0].body).toMatch(/request their approval in advance/);
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

describe("the cleaned-up core pages", () => {
  it("offers this season's services first, then next season's, each once", async () => {
    const { servicesBySeason } = await import("./evaluation-intake");
    const fall = servicesBySeason(new Date("2026-09-27T12:00:00"));
    expect(fall.map((g) => g.season)).toEqual(["fall", "winter"]);
    expect(fall[0].values).toContain("beds");
    expect(fall[0].values).toContain("holiday");
    expect(fall[1].values).toEqual(["snow"]);
    const winter = servicesBySeason(new Date("2027-01-10T12:00:00"));
    expect(winter.map((g) => g.season)).toEqual(["winter", "spring"]);
    expect(winter[0].values).toEqual(expect.arrayContaining(["removal", "holiday", "snow"]));
    expect(winter[1].values).toContain("beds");
    const all = [...fall[0].values, ...fall[1].values];
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain("other");
  });

  it("asks who else is involved when they have an HOA, even if they decide alone", async () => {
    const { asksForPeople, hasHoa } = await import("./evaluation-intake");
    expect(asksForPeople("me", { yard: ["hoa"] })).toBe(true);
    expect(hasHoa("me", { yard: ["hoa"] })).toBe(true);
    expect(asksForPeople("me", { yard: ["dog"] })).toBe(false);
    expect(asksForPeople("others")).toBe(true);
  });

  it("still reads answers the form no longer asks for", () => {
    const answers = cleanAnswers({ concerns: ["bad_experience"], details: { yard: ["steep", "dog_fence", "prior_contractor"] } });
    expect(answers.concerns).toEqual(["bad_experience"]);
    expect(answers.details.yard).toEqual(["steep", "dog_fence", "prior_contractor"]);
  });

  it("keeps what each person should see, and falls back to the plan only", () => {
    const answers = cleanAnswers({ people: [{ name: "Oak Ridge HOA", role: "HOA", contact: "board@example.com", sees: "all" }, { name: "Mom", sees: "nonsense" }] });
    expect(answers.people.map((p) => p.sees)).toEqual(["all", "scope"]);
  });
});

describe("photos by part of the yard", () => {
  it("asks for each part they picked, in the form's order, and the whole property as front, back and sides", async () => {
    const { photoAreasFor } = await import("./evaluation-intake");
    expect(photoAreasFor(["back", "front"])).toEqual(["front", "back"]);
    expect(photoAreasFor(["whole", "foundation"])).toEqual(["front", "back", "sides", "foundation"]);
    expect(photoAreasFor([])).toEqual(["whole"]);
  });

  it("keeps which part each photo is of, only for photos it holds", () => {
    const answers = cleanAnswers({
      photos: ["job/intake-a.jpg", "job/intake-b.jpg"],
      photo_areas: { "job/intake-a.jpg": "front", "job/intake-b.jpg": "nowhere", "job/intake-c.jpg": "back" },
    });
    expect(answers.photo_areas).toEqual({ "job/intake-a.jpg": "front" });
  });
});

describe("colours only for new plants", () => {
  it("asks about colours when new plants are going in, and not otherwise", () => {
    expect(asksLooks(cleanAnswers({ services: ["beds"], details: { beds_add: ["mulch", "plants"] } }))).toBe(true);
    expect(asksLooks(cleanAnswers({ services: ["beds"], details: { beds_add: ["mulch"] } }))).toBe(false);
    expect(asksLooks(cleanAnswers({ services: ["lawn", "washing"] }))).toBe(false);
    // Plants picked, then Beds taken off: no plants going in.
    expect(asksLooks(cleanAnswers({ services: ["lawn"], details: { beds_add: ["plants"] } }))).toBe(false);
  });
});

describe("an HOA's or a business's grounds", () => {
  it("knows grounds from a home", () => {
    expect(isGrounds({ property: "hoa" })).toBe(true);
    expect(isGrounds({ property: "commercial" })).toBe(true);
    expect(isGrounds({ property: "home" })).toBe(false);
    expect(isGrounds({ property: "" })).toBe(false);
  });

  it("offers common areas for grounds and yard parts for a home", () => {
    const grounds = areaOptionsFor(true).map((o) => o.value);
    const home = areaOptionsFor(false).map((o) => o.value);
    expect(grounds).toEqual(["entrance", "medians", "common", "ponds", "amenities", "streetside", "whole"]);
    expect(home).toEqual(["front", "back", "sides", "foundation", "whole"]);
  });

  it("keeps the common areas and the property kind it was given", () => {
    const answers = cleanAnswers({ property: "hoa", areas: ["entrance", "ponds"] });
    expect(answers.property).toBe("hoa");
    expect(answers.areas).toEqual(["entrance", "ponds"]);
  });

  it("asks for photos of each common area, and all of the grounds as one", () => {
    expect(photoAreasFor(["medians", "entrance"], true)).toEqual(["entrance", "medians"]);
    expect(photoAreasFor(["whole"], true)).toEqual(["whole"]);
    expect(photoAreasFor(["whole"], false)).toEqual(["front", "back", "sides"]);
  });

  it("says it is an HOA first, for the evaluator", () => {
    const answers = cleanAnswers({ property: "hoa", services: ["cleanup"], areas: ["entrance"] });
    expect(summarizeIntake(answers)[0]).toEqual({ label: "For", value: "An HOA or community" });
    expect(intakeHeadline(answers, "2026-10-01T12:00:00Z").startsWith("An HOA or community · ")).toBe(true);
  });
});

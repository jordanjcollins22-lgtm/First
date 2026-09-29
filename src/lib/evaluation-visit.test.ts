import { describe, expect, it } from "vitest";

import { cleanAnswers } from "./evaluation-intake";
import {
  addedItem,
  groupVisits,
  isSeededZone,
  markReviewed,
  mergePlan,
  putBack,
  readPlan,
  removeFromPlan,
  seedPlan,
  stillToReview,
  suggestionSeeds,
  visitStage,
  walkPlan,
  zoneSeeds,
} from "./evaluation-visit";

describe("where a visit is up to", () => {
  it("goes booked, on the way, arrived, submitted", () => {
    expect(visitStage({ evaluation_status: "scheduled" })).toBe("booked");
    expect(visitStage({ evaluation_status: "on_way" })).toBe("on_way");
    expect(visitStage({ evaluation_status: "scheduled", evaluator_arrived_at: "2026-09-27T14:00:00Z" })).toBe("arrived");
    expect(visitStage({ evaluation_status: "completed", evaluator_arrived_at: "x" })).toBe("submitted");
  });
});

describe("the site map from the client's form", () => {
  const answers = cleanAnswers({
    services: ["beds", "washing"],
    areas: ["front", "back"],
    details: { beds_add: ["mulch", "plants"] },
  });

  it("makes one piece of work per service in each part of the yard, and washing once", () => {
    const plan = seedPlan(answers);
    expect(plan.map((i) => `${i.area} ${i.label}`)).toEqual([
      "front Beds: mulch",
      "front New plants",
      "back Beds: mulch",
      "back New plants",
      "whole Soft washing",
    ]);
    // Every one a suggestion until the evaluator ticks or crosses it.
    expect(plan[0]).toEqual(expect.objectContaining({ typeId: "landscape-bed", values: { material: "Mulch" }, keep: null }));
  });

  it("keeps what was taken off, off, and brings in anything new on the form", () => {
    const first = seedPlan(answers).map((i, n) => ({ ...i, keep: n % 2 === 0 }));
    const later = seedPlan(cleanAnswers({ ...answers, services: ["beds", "washing", "cleanup"] }));
    const merged = mergePlan(first, later);
    expect(merged.slice(0, first.length)).toEqual(first);
    expect(merged.slice(first.length).map((i) => `${i.label} ${i.keep}`)).toEqual(["Cleanup null", "Cleanup null"]);
  });

  it("turns what was ticked, and anything added, into named zones, and leaves the rest as suggestions", () => {
    const plan = [...seedPlan(answers).map((i) => ({ ...i, keep: i.label === "New plants" ? false : i.id.startsWith("seed-front") ? null : true })), addedItem("sides", "trimming", "Trimming", "abc")];
    const seeds = zoneSeeds(plan);
    expect(seeds.map((s) => s.name)).toEqual(["Back yard · Beds: mulch", "The property · Soft washing", "Side yards · Trimming"]);
    expect(suggestionSeeds(plan).map((s) => s.name)).toEqual(["Front yard · Beds: mulch"]);
    expect(seeds.every((s) => isSeededZone(s.id))).toBe(true);
    expect(isSeededZone("0f8a3c2e-hand-drawn")).toBe(false);
  });

  it("reads back only what has the right shape", () => {
    expect(readPlan([{ id: "seed-a", area: "front", label: "Beds", keep: true, typeId: "landscape-bed" }, { nope: 1 }, "x"])).toEqual([
      { id: "seed-a", area: "front", service: null, typeId: "landscape-bed", label: "Beds", keep: true },
    ]);
    expect(readPlan(null)).toEqual([]);
  });
});

describe("the walkthrough", () => {
  const answers = cleanAnswers({
    services: ["beds", "lawn", "snow"],
    areas: ["front"],
    details: { beds_add: ["mulch"], mulch_color: "black", lawn_need: ["patch", "mowing"], lawn_method: "unsure" },
  });

  it("carries what they picked on their form onto the site map, and says which it was", () => {
    const plan = seedPlan(answers);
    const beds = plan.find((i) => i.label === "Beds: mulch")!;
    expect(beds.values).toEqual({ material: "Mulch", color: "Black" });
    expect(beds.fromForm).toEqual(["material", "color"]);
    // "Not sure" is not a choice: nothing to confirm.
    const repair = plan.find((i) => i.label === "Lawn: repair")!;
    expect(repair.values).toBeUndefined();
    expect(plan.find((i) => i.label === "Lawn: mowing")!.fromForm).toEqual(["serviceType"]);
    // Salting's defaults are ours, not theirs.
    expect(plan.find((i) => i.label === "Salting (prepaid)")!.fromForm).toBeUndefined();
  });

  it("counts everything they asked for as wanted, with nothing waiting on a yes", () => {
    const plan = walkPlan(seedPlan(answers));
    expect(plan.every((i) => i.keep === true)).toBe(true);
    // Something already taken off stays off.
    expect(walkPlan([{ ...plan[0], keep: false }])[0].keep).toBe(false);
  });

  it("waits for every area to be reviewed, and a removed one isn't waiting", () => {
    let plan = walkPlan(seedPlan(answers));
    const [first, second, ...rest] = plan;
    plan = markReviewed(plan, first.id);
    plan = removeFromPlan(plan, second.id);
    expect(stillToReview(plan).map((i) => i.id)).toEqual(rest.map((i) => i.id));
    for (const item of rest) plan = markReviewed(plan, item.id);
    expect(stillToReview(plan)).toEqual([]);
    // Put back, it has to be gone through again.
    plan = putBack(plan, second.id);
    expect(stillToReview(plan).map((i) => i.id)).toEqual([second.id]);
    expect(zoneSeeds(plan).map((s) => s.id)).toContain(second.id);
  });

  it("keeps the reviewed mark and the form's answers when saved and read back", () => {
    const item = { ...seedPlan(answers)[0], keep: true, reviewed: true };
    expect(readPlan([item])[0]).toEqual(expect.objectContaining({ reviewed: true, fromForm: ["material", "color"] }));
    expect(addedItem("back", "trimming", "Trimming", "x").reviewed).toBe(false);
  });
});

describe("the evaluator's day", () => {
  const now = new Date("2026-09-27T13:00:00Z"); // 9am in Maryland
  const row = (id: string, at: string, evaluationStatus = "scheduled", jobStatus = "estimating") => ({ id, evaluationDate: at, evaluationStatus, jobStatus });

  it("splits today, coming up and not written up, in the business's time zone", () => {
    const rows = [
      row("late-today", "2026-09-28T01:30:00Z"), // 9:30pm on the 27th in Maryland
      row("today", "2026-09-27T15:00:00Z"),
      row("tomorrow", "2026-09-28T14:00:00Z"),
      row("far", "2026-11-30T14:00:00Z"),
      row("owed", "2026-09-25T14:00:00Z", "arrived"),
      row("done", "2026-09-24T14:00:00Z", "completed"),
      row("signed-anyway", "2026-09-23T14:00:00Z", "scheduled", "approved"),
      row("cancelled", "2026-09-27T16:00:00Z", "cancelled"),
    ];
    const day = groupVisits(rows, now, "America/New_York");
    expect(day.today.map((r) => r.id)).toEqual(["today", "late-today"]);
    expect(day.upcoming.map((r) => r.id)).toEqual(["tomorrow"]);
    expect(day.toWriteUp.map((r) => r.id)).toEqual(["owed"]);
  });
});

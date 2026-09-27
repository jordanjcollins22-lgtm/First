import { describe, expect, it } from "vitest";

import { cleanAnswers } from "./evaluation-intake";
import { addedItem, groupVisits, isSeededZone, mergePlan, planAnswered, readPlan, seedPlan, visitStage, zoneSeeds } from "./evaluation-visit";

describe("where a visit is up to", () => {
  it("goes booked, on the way, arrived, submitted", () => {
    expect(visitStage({ evaluation_status: "scheduled" })).toBe("booked");
    expect(visitStage({ evaluation_status: "on_way" })).toBe("on_way");
    expect(visitStage({ evaluation_status: "scheduled", evaluator_arrived_at: "2026-09-27T14:00:00Z" })).toBe("arrived");
    expect(visitStage({ evaluation_status: "completed", evaluator_arrived_at: "x" })).toBe("submitted");
  });
});

describe("the site map set-up from the client's form", () => {
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
    expect(plan[0]).toEqual(expect.objectContaining({ typeId: "landscape-bed", values: { material: "Mulch" }, keep: null }));
  });

  it("keeps every answer already given, and brings in anything new on the form", () => {
    const first = seedPlan(answers).map((i, n) => ({ ...i, keep: n % 2 === 0 }));
    const later = seedPlan(cleanAnswers({ ...answers, services: ["beds", "washing", "cleanup"] }));
    const merged = mergePlan(first, later);
    expect(merged.slice(0, first.length)).toEqual(first);
    expect(merged.filter((i) => i.keep === null).map((i) => i.label)).toEqual(["Cleanup", "Cleanup"]);
  });

  it("is answered only when every piece has a Yes or a No", () => {
    const plan = seedPlan(answers);
    expect(planAnswered(plan)).toBe(false);
    expect(planAnswered(plan.map((i) => ({ ...i, keep: false })))).toBe(true);
    expect(planAnswered([])).toBe(false);
  });

  it("turns the Yeses, and anything added, into named zones", () => {
    const plan = [...seedPlan(answers).map((i) => ({ ...i, keep: i.label !== "New plants" })), addedItem("sides", "trimming", "Trimming", "abc")];
    const seeds = zoneSeeds(plan);
    expect(seeds.map((s) => s.name)).toEqual(["Front yard · Beds: mulch", "Back yard · Beds: mulch", "The property · Soft washing", "Side yards · Trimming"]);
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

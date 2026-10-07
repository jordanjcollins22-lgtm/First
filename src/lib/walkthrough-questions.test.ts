import { describe, expect, it } from "vitest";

import { SERVICE_TYPES, fieldApplies, serviceTypeById, withoutStale } from "@/components/canvas/service-catalog";
import { STEP_QUESTIONS, countQuestion, fieldQuestion, isClientField } from "./walkthrough-questions";

const field = (typeId: string, key: string) => {
  const found = serviceTypeById(typeId)?.fields.find((f) => f.key === key);
  if (!found) throw new Error(`${typeId}.${key} is not in the catalog`);
  return found;
};

describe("who answers each question on the walkthrough", () => {
  it("reads back what the client picked on their form, to confirm", () => {
    expect(fieldQuestion("landscape-bed", field("landscape-bed", "color"), "Brown", true)).toEqual({
      kind: "confirm",
      text: "You picked brown mulch. Is that still right?",
    });
    expect(fieldQuestion("landscape-bed", field("landscape-bed", "material"), "Rock", true).text).toBe(
      "You picked river rock for these beds. Is that still right?"
    );
  });

  it("asks the client what they want when their form didn't say", () => {
    expect(fieldQuestion("landscape-bed", field("landscape-bed", "color"), undefined, false)).toEqual({
      kind: "ask",
      text: "What colour mulch would you like?",
    });
    // A default we filled in is not something they chose: asked, not confirmed.
    expect(fieldQuestion("salting", field("salting", "treatments"), "3", false).kind).toBe("ask");
  });

  it("leaves what the evaluator can see to the evaluator, and never reads it out", () => {
    expect(fieldQuestion("landscape-bed", field("landscape-bed", "weedLevel"), undefined, false)).toEqual({
      kind: "check",
      text: "How many weeds are there?",
    });
    // Even a value somebody set earlier is not the client's to confirm.
    expect(fieldQuestion("landscape-bed", field("landscape-bed", "edge"), "No Edge", true).kind).toBe("check");
    expect(isClientField("landscape-cleanup", "overgrowth")).toBe(false);
    expect(isClientField("landscape-cleanup", "plantsStaying")).toBe(true);
  });

  it("gives every field in the catalog a question with words to show", () => {
    for (const type of SERVICE_TYPES) {
      for (const f of type.fields.filter((x) => !x.checklistItem)) {
        const q = fieldQuestion(type.id, f, undefined, false);
        expect(q.text.length, `${type.id}.${f.key}`).toBeGreaterThan(3);
      }
    }
  });

  it("has the evaluator measure, photograph and count, and the client say what they want done", () => {
    expect(STEP_QUESTIONS.measurements.kind).toBe("check");
    expect(STEP_QUESTIONS.photos.kind).toBe("check");
    expect(STEP_QUESTIONS.checklist.kind).toBe("ask");
    expect(countQuestion("bushes")).toEqual({ kind: "check", text: "How many bushes?" });
  });
});

describe("questions that only apply to some answers", () => {
  it("asks mulch colour only for mulch, and rock size only for rock", () => {
    const colour = field("landscape-bed", "color");
    expect(fieldApplies(colour, { material: "Mulch" })).toBe(true);
    expect(fieldApplies(colour, { material: "Rock" })).toBe(false);
    expect(fieldApplies(field("landscape-bed", "weedLevel"), {})).toBe(true);
  });

  it("drops a mulch colour when the bed changes to rock, so the crew isn't told both", () => {
    const fields = serviceTypeById("landscape-bed")!.fields;
    expect(withoutStale(fields, { material: "Rock", color: "Brown", weedLevel: "Light" })).toEqual({ material: "Rock", weedLevel: "Light" });
    expect(withoutStale(fields, { material: "Mulch", color: "Brown" })).toEqual({ material: "Mulch", color: "Brown" });
  });
});

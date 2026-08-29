import { describe, expect, it } from "vitest";

import {
  applyZoneEdit,
  describeEvaluationChange,
  describeZoneChange,
  editFor,
  manualZone,
  manualZoneReady,
  needsLinearAnswer,
  type EditableZone,
  type ZoneEdit,
} from "./evaluation-edit";

function zone(overrides: Partial<EditableZone> = {}): EditableZone {
  return {
    id: "z1",
    name: "Back bed",
    lengthFt: 20,
    widthFt: 10,
    measurementKind: "area",
    areaSqFt: 200,
    perimeterFt: 60,
    service: { notes: "Two yards of mulch." },
    ...overrides,
  };
}

function edit(overrides: Partial<ZoneEdit> = {}): ZoneEdit {
  // Defaults match the saved zone, so a test that changes one thing changes
  // exactly one thing.
  return {
    id: "z1",
    name: "Back bed",
    length: "20",
    width: "10",
    linear: false,
    notes: "Two yards of mulch.",
    ...overrides,
  };
}

describe("editFor", () => {
  it("fills the form from the saved zone", () => {
    expect(editFor(zone())).toEqual({
      id: "z1",
      name: "Back bed",
      length: "20",
      width: "10",
      linear: false,
      notes: "Two yards of mulch.",
    });
  });

  it("leaves the boxes empty for an unmeasured zone", () => {
    const form = editFor(zone({ lengthFt: null, widthFt: null, measurementKind: "none" }));
    expect(form.length).toBe("");
    expect(form.width).toBe("");
  });

  it("remembers that a run was a run", () => {
    expect(editFor(zone({ measurementKind: "linear", widthFt: null })).linear).toBe(true);
  });
});

describe("applyZoneEdit", () => {
  it("re-derives the area rather than carrying a stale one", () => {
    const after = applyZoneEdit(zone(), edit({ length: "30" }));
    expect(after.lengthFt).toBe(30);
    expect(after.areaSqFt).toBe(300);
    expect(after.perimeterFt).toBe(80);
  });

  it("turns a rectangle into a run when told it is one", () => {
    const after = applyZoneEdit(zone(), edit({ width: "", linear: true }));
    expect(after.measurementKind).toBe("linear");
    expect(after.areaSqFt).toBeNull();
    expect(after.perimeterFt).toBe(20);
  });

  it("gives nothing back for a length with no width and no answer", () => {
    const after = applyZoneEdit(zone(), edit({ width: "", linear: false }));
    expect(after.measurementKind).toBe("none");
    expect(after.areaSqFt).toBeNull();
  });

  it("keeps the old name rather than saving a blank one", () => {
    expect(applyZoneEdit(zone(), edit({ name: "   " })).name).toBe("Back bed");
  });

  it("writes the notes onto the service", () => {
    const after = applyZoneEdit(zone(), edit({ notes: "Client wants black mulch." }));
    expect(after.service?.notes).toBe("Client wants black mulch.");
  });

  it("leaves a zone with no service alone rather than inventing one", () => {
    expect(applyZoneEdit(zone({ service: null }), edit({ notes: "x" })).service).toBeNull();
  });

  it("does not mutate the zone it was given", () => {
    const original = zone();
    applyZoneEdit(original, edit({ length: "99" }));
    expect(original.lengthFt).toBe(20);
  });
});

describe("needsLinearAnswer", () => {
  it("asks when a length is in and a width is not", () => {
    expect(needsLinearAnswer(edit({ width: "" }))).toBe(true);
  });

  it("stops asking once somebody says it is a run", () => {
    expect(needsLinearAnswer(edit({ width: "", linear: true }))).toBe(false);
  });

  it("does not ask about a finished rectangle", () => {
    expect(needsLinearAnswer(edit())).toBe(false);
  });
});

describe("describeZoneChange", () => {
  it("says what the measurement moved from and to", () => {
    const after = applyZoneEdit(zone(), edit({ length: "30" }));
    expect(describeZoneChange(zone(), after)).toEqual(["Back bed measurement 20 × 10 ft → 30 × 10 ft"]);
  });

  it("says a rename in both names", () => {
    const after = applyZoneEdit(zone(), edit({ name: "Rear bed" }));
    expect(describeZoneChange(zone(), after)[0]).toBe("Back bed renamed to Rear bed");
  });

  it("notices notes going in and coming out", () => {
    const withNotes = applyZoneEdit(zone(), edit({ notes: "Black mulch." }));
    expect(describeZoneChange(zone(), withNotes)).toContain("Back bed notes updated");
    const cleared = applyZoneEdit(zone(), edit({ notes: "" }));
    expect(describeZoneChange(zone(), cleared)).toContain("Back bed notes cleared");
  });

  it("says nothing when nothing moved", () => {
    expect(describeZoneChange(zone(), applyZoneEdit(zone(), editFor(zone())))).toEqual([]);
  });
});

describe("describeEvaluationChange", () => {
  const front = zone({ id: "z2", name: "Front bed" });

  it("records a removal", () => {
    const changes = describeEvaluationChange({ before: [zone(), front], after: [front] });
    expect(changes).toEqual(["Removed Back bed"]);
  });

  it("records an addition with its size", () => {
    const added = manualZone({
      id: "z3",
      name: "Side hedge",
      serviceTypeId: "hedge",
      length: "40",
      width: "",
      linear: true,
      notes: "",
      color: "#000",
    });
    const changes = describeEvaluationChange({ before: [zone()], after: [zone(), added] });
    expect(changes).toEqual(["Added Side hedge (40 ft run)"]);
  });

  it("records edits and removals in one pass", () => {
    const edited = applyZoneEdit(zone(), edit({ length: "30" }));
    const changes = describeEvaluationChange({ before: [zone(), front], after: [edited] });
    expect(changes).toEqual([
      "Back bed measurement 20 × 10 ft → 30 × 10 ft",
      "Removed Front bed",
    ]);
  });

  it("is empty when the evaluation is untouched", () => {
    expect(describeEvaluationChange({ before: [zone()], after: [zone()] })).toEqual([]);
  });
});

describe("manualZone", () => {
  it("has no shape on the map, since nobody stood there", () => {
    const added = manualZone({
      id: "z9",
      name: "Side hedge",
      serviceTypeId: "hedge",
      length: "40",
      width: "3",
      linear: false,
      notes: "From the phone call.",
      color: "#111",
    });
    expect(added.points).toEqual([]);
    expect(added.areaSqFt).toBe(120);
    expect((added.service as { notes: string }).notes).toBe("From the phone call.");
  });

  it("falls back rather than saving an unnamed area", () => {
    const added = manualZone({
      id: "z9",
      name: "  ",
      serviceTypeId: "hedge",
      length: "",
      width: "",
      linear: false,
      notes: "",
      color: "#111",
    });
    expect(added.name).toBe("New area");
  });
});

describe("manualZoneReady", () => {
  it("needs a name and a service", () => {
    expect(manualZoneReady({ name: "Side hedge", serviceTypeId: "hedge" })).toBe(true);
    expect(manualZoneReady({ name: "", serviceTypeId: "hedge" })).toBe(false);
    expect(manualZoneReady({ name: "Side hedge", serviceTypeId: null })).toBe(false);
  });
});

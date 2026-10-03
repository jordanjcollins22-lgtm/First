import { describe, expect, it } from "vitest";

import {
  describeMeasurement,
  kindOfSaved,
  measurementIsSettled,
  readMeasurement,
} from "./zone-measurement";

describe("readMeasurement", () => {
  it("reads a rectangle as an area", () => {
    const m = readMeasurement({ length: "40", width: "6" });
    expect(m.kind).toBe("area");
    expect(m.areaSqFt).toBe(240);
    expect(m.perimeterFt).toBe(92);
    expect(m.needsConfirmation).toBe(false);
  });

  it("will not guess from a length alone", () => {
    // The width box being empty means "this is a line" or "I am still
    // typing", and the difference is a price.
    const m = readMeasurement({ length: "120", width: "" });
    expect(m.kind).toBe("none");
    expect(m.needsConfirmation).toBe(true);
    expect(m.areaSqFt).toBeNull();
    expect(m.perimeterFt).toBeNull();
  });

  it("keeps the length it was given while waiting to be told", () => {
    // So the box does not empty itself under the evaluator's thumb.
    expect(readMeasurement({ length: "120", width: "" }).lengthFt).toBe(120);
  });

  it("reads a confirmed length as linear feet", () => {
    const m = readMeasurement({ length: "120", width: "", linearConfirmed: true });
    expect(m.kind).toBe("linear");
    expect(m.lengthFt).toBe(120);
    expect(m.needsConfirmation).toBe(false);
  });

  it("never gives a linear run an area", () => {
    // A service priced by the square foot must get nothing rather than a
    // rectangle nobody measured.
    expect(readMeasurement({ length: "120", width: "", linearConfirmed: true }).areaSqFt).toBeNull();
  });

  it("puts a linear run's length in the feet-of-work figure", () => {
    // Which is what a service priced by the foot reads, so crack weeding
    // prices off 120 ft without knowing it was not a rectangle.
    expect(readMeasurement({ length: "120", width: "", linearConfirmed: true }).perimeterFt).toBe(120);
  });

  it("ignores the confirmation once a width is entered", () => {
    // Ticking "length only" and then typing a width is a change of mind, and
    // the width is the newer statement.
    const m = readMeasurement({ length: "40", width: "6", linearConfirmed: true });
    expect(m.kind).toBe("area");
    expect(m.areaSqFt).toBe(240);
  });

  it("is not measured on an empty form", () => {
    const m = readMeasurement({ length: "", width: "" });
    expect(m.kind).toBe("none");
    expect(m.needsConfirmation).toBe(false);
  });

  it("does not ask about a width with no length", () => {
    const m = readMeasurement({ length: "", width: "6" });
    expect(m.kind).toBe("none");
    expect(m.needsConfirmation).toBe(false);
    expect(m.widthFt).toBe(6);
  });

  it("treats zero and nonsense as not entered", () => {
    for (const bad of ["0", "-4", "abc", " ", null, undefined]) {
      expect(readMeasurement({ length: bad, width: "6" }).kind).toBe("none");
      expect(readMeasurement({ length: "40", width: bad }).needsConfirmation).toBe(true);
    }
  });

  it("takes numbers as well as strings", () => {
    const m = readMeasurement({ length: 40, width: 6 });
    expect(m.areaSqFt).toBe(240);
  });

  it("handles decimals", () => {
    const m = readMeasurement({ length: "12.5", width: "4.2" });
    expect(m.areaSqFt).toBeCloseTo(52.5, 6);
  });
});

describe("describeMeasurement", () => {
  it("says linear feet for a run", () => {
    const m = readMeasurement({ length: "120", width: "", linearConfirmed: true });
    expect(describeMeasurement(m)).toBe("= 120 linear ft");
  });

  it("says both figures for a rectangle", () => {
    const m = readMeasurement({ length: "40", width: "6" });
    expect(describeMeasurement(m)).toBe("= 240 sq ft · 92 ft perimeter");
  });

  it("says nothing while it is still waiting to be told", () => {
    expect(describeMeasurement(readMeasurement({ length: "120", width: "" }))).toBeNull();
  });

  it("says nothing for an empty form", () => {
    expect(describeMeasurement(readMeasurement({ length: "", width: "" }))).toBeNull();
  });

  it("never shows a square foot figure for a run", () => {
    const m = readMeasurement({ length: "120", width: "", linearConfirmed: true });
    expect(describeMeasurement(m)).not.toMatch(/sq ft/);
  });
});

describe("measurementIsSettled", () => {
  it("blocks an unconfirmed length", () => {
    expect(measurementIsSettled(readMeasurement({ length: "120", width: "" }))).toBe(false);
  });

  it("allows a confirmed one", () => {
    expect(
      measurementIsSettled(readMeasurement({ length: "120", width: "", linearConfirmed: true }))
    ).toBe(true);
  });

  it("allows a rectangle", () => {
    expect(measurementIsSettled(readMeasurement({ length: "40", width: "6" }))).toBe(true);
  });

  it("allows an untouched form — measuring is not compulsory", () => {
    expect(measurementIsSettled(readMeasurement({ length: "", width: "" }))).toBe(true);
  });
});

describe("kindOfSaved", () => {
  it("trusts the kind when the zone carries one", () => {
    expect(kindOfSaved({ measurementKind: "linear", lengthFt: 40, widthFt: 6, areaSqFt: 240 })).toBe(
      "linear"
    );
  });

  it("reads an old length-only zone as a run", () => {
    expect(kindOfSaved({ lengthFt: 120, widthFt: null, areaSqFt: null })).toBe("linear");
  });

  it("reads an old rectangle as an area", () => {
    expect(kindOfSaved({ lengthFt: 40, widthFt: 6, areaSqFt: 240 })).toBe("area");
  });

  it("reads an old zone with only an area as an area", () => {
    // Measured before length and width existed as fields at all.
    expect(kindOfSaved({ areaSqFt: 900 })).toBe("area");
  });

  it("says nothing about an unmeasured zone", () => {
    expect(kindOfSaved({})).toBe("none");
  });
});

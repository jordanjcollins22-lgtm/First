import { describe, expect, it } from "vitest";

import { discFor, initialsFor, listDate, previewOf } from "./initials";

describe("initialsFor", () => {
  it("takes the first and last word", () => {
    expect(initialsFor("Jo Miller")).toBe("JM");
    expect(initialsFor("William Duvall")).toBe("WD");
  });

  it("skips the middle", () => {
    expect(initialsFor("Mary Jane Watson")).toBe("MW");
  });

  it("copes with one word", () => {
    expect(initialsFor("Cher")).toBe("C");
  });

  it("is not confused by extra spaces", () => {
    expect(initialsFor("   Jo    Miller  ")).toBe("JM");
  });

  it("handles a business name", () => {
    expect(initialsFor("Js Landscaping Services LLC")).toBe("JL");
  });

  it("shows something for a name it cannot read", () => {
    // A blank disc looks like a rendering fault.
    expect(initialsFor("")).toBe("?");
    expect(initialsFor("   ")).toBe("?");
    expect(initialsFor("!!!")).toBe("?");
  });

  it("uses the first digits for a row that is only a phone number", () => {
    // Somebody texted in and nobody has put a name to them yet. Initials
    // mean nothing there, and two digits at least make the row recognisable.
    expect(initialsFor("(252) 666-2805")).toBe("25");
    expect(initialsFor("+1 410-459-5621")).toBe("14");
  });

  it("ignores punctuation stuck to a name", () => {
    expect(initialsFor("(Jo) Miller")).toBe("JM");
  });
});

describe("discFor", () => {
  it("gives the same person the same colour every time", () => {
    // Somebody whose disc changes colour has, to the eye, become a
    // different person.
    expect(discFor("Jo Miller")).toEqual(discFor("Jo Miller"));
  });

  it("ignores casing and stray spaces, which are not a different person", () => {
    expect(discFor("jo miller")).toEqual(discFor("  Jo Miller "));
  });

  it("gives different names different colours, mostly", () => {
    const names = ["Jo Miller", "Sam Reed", "Pat Lowe", "Linda Holden", "Roger Wolfe"];
    const colours = new Set(names.map((n) => discFor(n).bg));
    expect(colours.size).toBeGreaterThan(1);
  });

  it("always returns a colour with readable text on it", () => {
    for (const name of ["", "A", "Zebedee", "Js Landscaping"]) {
      const disc = discFor(name);
      expect(disc.bg).toMatch(/^#[0-9a-f]{6}$/);
      expect(disc.text).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("listDate", () => {
  const now = new Date("2026-08-28T15:00:00Z");

  it("shows a time for today", () => {
    expect(listDate("2026-08-28T09:04:00Z", now)).toMatch(/^\d/);
    expect(listDate("2026-08-28T09:04:00Z", now)).toContain(":");
  });

  it("shows a date for anything older", () => {
    expect(listDate("2026-08-27T09:04:00Z", now)).toBe("8/27/2026");
  });

  it("says nothing for a timestamp it cannot read", () => {
    expect(listDate("nope", now)).toBe("");
  });
});

describe("previewOf", () => {
  it("flattens a message onto one line", () => {
    expect(previewOf("Hi Jace,\n\nHere are the photos.")).toBe("Hi Jace, Here are the photos.");
  });

  it("cuts a long one rather than letting it push the date off", () => {
    const long = "a".repeat(200);
    const preview = previewOf(long, 20);
    expect(preview).toHaveLength(20);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("leaves a short one alone", () => {
    expect(previewOf("Thank you !!!")).toBe("Thank you !!!");
  });
});

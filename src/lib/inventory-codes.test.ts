import { describe, expect, it } from "vitest";

import { CODE_LENGTH, generateCode, isValidCode, normaliseCode, scanPath } from "@/lib/inventory-codes";

describe("generateCode", () => {
  it("is the length printed on the label", () => {
    expect(generateCode()).toHaveLength(CODE_LENGTH);
  });

  it("leaves out the characters that get misread", () => {
    // A thousand codes, and not one O, I, L, U, 0 or 1 between them.
    const many = Array.from({ length: 1000 }, () => generateCode()).join("");
    expect(many).not.toMatch(/[OIL U01]/);
  });

  it("is what the random source says, so it can be tested at all", () => {
    expect(generateCode(() => 0)).toBe("222222");
  });
});

describe("normaliseCode", () => {
  it("does not care about case or spacing", () => {
    expect(normaliseCode(" a b-c 2 3 4 ")).toBe("ABC234");
  });

  it("folds the lookalikes onto real characters", () => {
    // Somebody reading a label in the rain says O for Q and I for 7.
    expect(normaliseCode("OIL")).toBe(normaliseCode("Q77"));
    expect(normaliseCode("U")).toBe("V");
  });

  it("leaves a good code alone", () => {
    expect(normaliseCode("XK4M9P")).toBe("XK4M9P");
  });
});

describe("isValidCode", () => {
  it("accepts what it generates, every time", () => {
    for (let i = 0; i < 200; i++) expect(isValidCode(generateCode())).toBe(true);
  });

  it("accepts a code somebody typed loosely", () => {
    const code = generateCode();
    expect(isValidCode(` ${code.toLowerCase()} `)).toBe(true);
  });

  it("refuses the wrong length", () => {
    expect(isValidCode("ABC")).toBe(false);
    expect(isValidCode("ABCDEFGH")).toBe(false);
  });

  it("refuses punctuation", () => {
    expect(isValidCode("AB*D34")).toBe(false);
  });
});

describe("scanPath", () => {
  it("is short, so the code stays coarse enough to scan from a distance", () => {
    expect(scanPath("XK4M9P")).toBe("/i/XK4M9P");
  });
});

import { describe, expect, it } from "vitest";
import { bytesDiffer, compareImagery, describeImagery } from "./image-identity";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("bytesDiffer", () => {
  it("says two identical photos are identical", () => {
    expect(bytesDiffer(bytes(1, 2, 3), bytes(1, 2, 3))).toBe(false);
  });

  it("notices a different length without reading further", () => {
    expect(bytesDiffer(bytes(1, 2, 3), bytes(1, 2, 3, 4))).toBe(true);
  });

  it("notices a difference at the very end", () => {
    // The cheap version compares the first few bytes and calls it a match.
    // Two satellite photos of the same place share a great many leading
    // bytes.
    expect(bytesDiffer(bytes(1, 2, 3, 4), bytes(1, 2, 3, 5))).toBe(true);
  });

  it("treats two empty photos as the same", () => {
    expect(bytesDiffer(bytes(), bytes())).toBe(false);
  });
});

describe("compareImagery", () => {
  it("reports a genuinely new photo as changed", async () => {
    const verdict = await compareImagery(new Blob([bytes(1, 2, 3)]), new Blob([bytes(9, 9, 9)]));
    expect(verdict).toBe("changed");
  });

  it("reports the same photo as unchanged", async () => {
    const verdict = await compareImagery(new Blob([bytes(1, 2, 3)]), new Blob([bytes(1, 2, 3)]));
    expect(verdict).toBe("same");
  });

  it("says it could not tell rather than guessing", async () => {
    // A comparison that failed is not evidence that nothing changed.
    const broken = { arrayBuffer: () => Promise.reject(new Error("nope")) } as unknown as Blob;
    expect(await compareImagery(broken, new Blob([bytes(1)]))).toBe("unknown");
  });
});

describe("describeImagery", () => {
  it("claims only what was actually established", () => {
    // There is no capture date to be had, so the wording says the imagery
    // differs rather than that it is newer.
    expect(describeImagery("changed")).toMatch(/different imagery/i);
    expect(describeImagery("changed")).not.toMatch(/newer|newest/i);
  });

  it("says nothing was touched when it could not tell", () => {
    expect(describeImagery("unknown")).toMatch(/nothing on the board was changed/i);
  });

  it("has an answer for no change", () => {
    expect(describeImagery("same")).toMatch(/most recent/i);
  });
});

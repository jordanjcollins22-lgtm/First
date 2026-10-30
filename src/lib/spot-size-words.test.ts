import { describe, expect, it } from "vitest";

import { AT_VISIT, clientSizeWords, needsChecking, officeSourceWords, readSizing, roundSqft, sizeAmount } from "@/lib/spot-size-words";
import type { SpotSizing } from "@/lib/spot-sizing";

const spot = (over: Partial<SpotSizing> = {}): SpotSizing => ({
  index: 0,
  choices: ["mulch"],
  areaSqft: 637,
  count: null,
  source: "traced",
  confidence: "high",
  from: "Traced on the map",
  priceCents: 50000,
  ...over,
});

describe("roundSqft", () => {
  it("rounds the way a person says it", () => {
    expect(roundSqft(43)).toBe(45);
    expect(roundSqft(637)).toBe(640);
    expect(roundSqft(1234)).toBe(1250);
    expect(roundSqft(1)).toBe(5);
  });
});

describe("sizeAmount", () => {
  it("gives area and count", () => {
    expect(sizeAmount(spot({ choices: ["mulch", "trim"], count: 6 }))).toBe("About 640 sq ft and 6 bushes to trim");
  });
  it("reads the count as the first counted choice, remove before trim", () => {
    expect(sizeAmount(spot({ choices: ["trim", "remove"], areaSqft: null, count: 1 }))).toBe("About 1 bush to take out");
  });
  it("calls a lone wash's area siding", () => {
    expect(sizeAmount(spot({ choices: ["wash"], areaSqft: 1600 }))).toBe("About 1,600 sq ft of siding");
  });
  it("is null with nothing to say", () => {
    expect(sizeAmount(spot({ areaSqft: null }))).toBeNull();
  });
});

describe("clientSizeWords", () => {
  it("says where a firm size came from", () => {
    expect(clientSizeWords(spot(), { hasPhotos: false })).toBe("About 640 sq ft, traced on the map");
    expect(clientSizeWords(spot({ source: "ai", confidence: "medium" }), { hasPhotos: true })).toBe(
      "About 640 sq ft, from the satellite picture and your photos"
    );
    expect(clientSizeWords(spot({ source: "ai", confidence: "high" }), { hasPhotos: false })).toBe("About 640 sq ft, from the satellite picture");
    expect(clientSizeWords(spot({ source: "history", confidence: "medium" }), { hasPhotos: false })).toMatch(/yards we've measured/);
  });
  it("never passes a stand-in off as a measurement", () => {
    expect(clientSizeWords(spot({ source: "typical", confidence: "low" }), { hasPhotos: true })).toBe(AT_VISIT);
    expect(clientSizeWords(spot({ source: "ai", confidence: "low" }), { hasPhotos: true })).toBe(AT_VISIT);
  });
  it("keeps a traced area when only the count is a stand-in", () => {
    expect(clientSizeWords(spot({ choices: ["mulch", "trim"], count: 4, source: "typical", confidence: "low" }), { hasPhotos: false, traced: true })).toBe(
      "About 640 sq ft, traced on the map. We'll count the rest at your visit"
    );
  });
  it("says nothing for a spot only priced on the visit", () => {
    expect(clientSizeWords(spot({ choices: ["other"], areaSqft: null, priceCents: null, source: "typical", confidence: "low" }), { hasPhotos: false })).toBeNull();
  });
});

describe("office words", () => {
  it("names source and confidence, and flags what to check", () => {
    expect(officeSourceWords(spot())).toBe("Traced by client · high confidence");
    expect(needsChecking(spot())).toBe(false);
    expect(needsChecking(spot({ source: "history", confidence: "medium" }))).toBe(true);
    expect(needsChecking(spot({ source: "ai", confidence: "low" }))).toBe(true);
  });
});

describe("readSizing", () => {
  it("is empty for estimates from before sizes were kept", () => {
    expect(readSizing(null)).toEqual([]);
    expect(readSizing({})).toEqual([]);
  });
  it("reads good rows and skips bad ones", () => {
    const rows = readSizing([
      { ...spot(), aiNote: "A mulched bed along the drive", aiConfidence: "medium" },
      { ...spot(), source: "guess" },
      { ...spot(), index: "1" },
      "junk",
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ index: 0, areaSqft: 637, aiNote: "A mulched bed along the drive", aiConfidence: "medium" });
  });
  it("drops an empty note and an unknown confidence", () => {
    expect(readSizing([{ ...spot(), aiNote: "  ", aiConfidence: "very" }])[0]).toMatchObject({ aiNote: null, aiConfidence: null });
  });
});

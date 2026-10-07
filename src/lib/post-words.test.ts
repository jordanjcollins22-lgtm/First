import { describe, expect, it } from "vitest";

import { requestByWords, wordsReason } from "./post-words";

describe("requestByWords", () => {
  it("flags a neighbour asking for yard work", () => {
    expect(requestByWords("Does anyone know a good lawn guy in Bel Air?").request).toBe(true);
    expect(requestByWords("Looking for someone to do a leaf cleanup this week, Abingdon").request).toBe(true);
    expect(requestByWords("Can anyone recommend a tree service? Big oak came down").request).toBe(true);
  });

  it("leaves a post that names no work", () => {
    expect(requestByWords("Can anyone recommend a good dentist in Fallston?").request).toBe(false);
  });

  it("leaves a post that asks for nothing", () => {
    expect(requestByWords("Beautiful fall leaves on the trail this morning").request).toBe(false);
  });

  it("never flags a business selling its own work", () => {
    const ad = requestByWords("Looking for lawn care? We're licensed and insured, free estimates!");
    expect(ad.request).toBe(false);
    expect(ad.matched).toContain("licensed");
  });

  it("matches words from their start only", () => {
    expect(requestByWords("Does anyone know when the next episode airs?").request).toBe(false);
  });

  it("says why, in words the board can show", () => {
    const verdict = requestByWords("Anyone know someone for mulch and hedge trimming?");
    expect(verdict.request).toBe(true);
    expect(wordsReason(verdict.matched)).toMatch(/^Flagged by words, not checked yet: anyone know/);
  });
});

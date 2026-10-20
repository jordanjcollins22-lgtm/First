import { describe, expect, it } from "vitest";

import { affiliateLink, landingUrlFor, normalizeAffiliateCode } from "./affiliate";

describe("affiliate links", () => {
  it("builds a short scan link from the app origin", () => {
    expect(affiliateLink("https://crew.example.com/", " k7qm2p ")).toBe("https://crew.example.com/r/K7QM2P");
  });

  it("strips anything that isn't part of a code", () => {
    expect(normalizeAffiliateCode("k7-qm 2p")).toBe("K7QM2P");
  });

  it("adds ref to the landing page without losing its own query", () => {
    expect(landingUrlFor("https://example.com/quote?utm_source=truck", "K7QM2P")).toBe(
      "https://example.com/quote?utm_source=truck&ref=K7QM2P"
    );
    expect(landingUrlFor("https://example.com/quote", null)).toBe("https://example.com/quote");
  });
});

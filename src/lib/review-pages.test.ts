import { describe, expect, it } from "vitest";
import { reviewPagesEnabled } from "./review-pages";

describe("review pages", () => {
  it("exist on a Vercel preview", () => {
    expect(reviewPagesEnabled({ VERCEL_ENV: "preview", NODE_ENV: "production" })).toBe(true);
  });
  it("never exist on the live site", () => {
    expect(reviewPagesEnabled({ VERCEL_ENV: "production", NODE_ENV: "production" })).toBe(false);
    expect(reviewPagesEnabled({ NODE_ENV: "production" })).toBe(false);
  });
  it("exist when running locally", () => {
    expect(reviewPagesEnabled({ NODE_ENV: "development" })).toBe(true);
  });
});

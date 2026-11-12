import { describe, expect, it } from "vitest";
import { contentPool } from "./content-pool";

describe("contentPool", () => {
  it("takes 25% of the profit on sold jobs from content and splits it evenly", () => {
    const p = contentPool(
      [
        { fromContent: true, sold: true, profit: 1200 },
        { fromContent: true, sold: true, profit: 800 },
        { fromContent: false, sold: true, profit: 5000 },
        { fromContent: true, sold: false, profit: null },
      ],
      ["Sam", "Alex"]
    );
    expect(p).toEqual({ jobs: 2, unpriced: 0, profit: 2000, pool: 500, perPerson: 250, team: ["Sam", "Alex"] });
  });

  it("counts a content job with no profit worked out but leaves it out of the pool", () => {
    const p = contentPool([{ fromContent: true, sold: true, profit: null }, { fromContent: true, sold: true, profit: 400 }], ["Sam"]);
    expect(p.jobs).toBe(2);
    expect(p.unpriced).toBe(1);
    expect(p.pool).toBe(100);
  });

  it("never lets a loss take money out of the pool", () => {
    expect(contentPool([{ fromContent: true, sold: true, profit: -300 }], ["Sam"]).pool).toBe(0);
  });

  it("has no per-person share with nobody on the team", () => {
    expect(contentPool([{ fromContent: true, sold: true, profit: 400 }], []).perPerson).toBe(0);
  });
});

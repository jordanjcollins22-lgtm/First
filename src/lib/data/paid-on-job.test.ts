import { describe, expect, it } from "vitest";

import { balanceCents } from "@/lib/data/paid-on-job";

describe("the balance on a job", () => {
  it("is the total less what has been paid", () => {
    expect(balanceCents(126400, 63200)).toBe(63200);
    expect(balanceCents(126400, 0)).toBe(126400);
  });

  it("never goes below zero", () => {
    expect(balanceCents(126400, 130000)).toBe(0);
    expect(balanceCents(126400, -500)).toBe(126400);
  });
});

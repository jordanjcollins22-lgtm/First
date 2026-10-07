import { describe, expect, it } from "vitest";

import { parseDollars, receiptsTotal, sayDollars } from "@/lib/job-receipts";

describe("receipts", () => {
  it("reads a price the way it's typed", () => {
    expect(parseDollars("12.50")).toBe(1250);
    expect(parseDollars("$1,204")).toBe(120400);
    expect(parseDollars(" 7 ")).toBe(700);
    expect(parseDollars("")).toBeNull();
    expect(parseDollars("twelve")).toBeNull();
    expect(parseDollars("1.234")).toBeNull();
  });

  it("says and totals it", () => {
    expect(sayDollars(1250)).toBe("$12.50");
    expect(receiptsTotal([{ amountCents: 1250 }, { amountCents: null }, { amountCents: 800 }])).toBe(2050);
  });
});

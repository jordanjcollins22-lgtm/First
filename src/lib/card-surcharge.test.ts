import { describe, expect, it } from "vitest";
import {
  SURCHARGE_RATE,
  splitPaidTotal,
  surchargeCents,
  surchargeNotice,
  totalWithSurcharge,
} from "./card-surcharge";

describe("surchargeCents", () => {
  it("charges three and a half percent", () => {
    expect(SURCHARGE_RATE).toBe(0.035);
    expect(surchargeCents(100000)).toBe(3500);
  });

  it("rounds to a whole penny", () => {
    // 3.5% of $1,234.56 is $43.2096. A total that is not a whole number of
    // pennies is a total that cannot match a bank statement.
    expect(surchargeCents(123456)).toBe(4321);
    expect(Number.isInteger(surchargeCents(123456))).toBe(true);
  });

  it("charges nothing on nothing", () => {
    expect(surchargeCents(0)).toBe(0);
    expect(surchargeCents(-500)).toBe(0);
    expect(surchargeCents(Number.NaN)).toBe(0);
  });
});

describe("totalWithSurcharge", () => {
  it("adds the fee to the price", () => {
    expect(totalWithSurcharge(452000)).toBe(452000 + 15820);
  });
});

describe("splitPaidTotal", () => {
  it("uses the original amount when the caller knows it", () => {
    const total = totalWithSurcharge(452000);
    expect(splitPaidTotal({ totalCents: total, workCents: 452000 })).toEqual({
      workCents: 452000,
      surchargeCents: 15820,
    });
  });

  it("works the split back out when nobody recorded the original", () => {
    const total = totalWithSurcharge(100000);
    const split = splitPaidTotal({ totalCents: total });
    expect(split.workCents).toBe(100000);
    expect(split.surchargeCents).toBe(3500);
  });

  it("always adds back up to what actually arrived", () => {
    // The number that has to reconcile with the bank is the total. Whatever
    // the split says, it must not invent or lose a penny.
    for (const amount of [1, 999, 123456, 3105000, 819000]) {
      const total = totalWithSurcharge(amount);
      for (const known of [amount, null]) {
        const split = splitPaidTotal({ totalCents: total, workCents: known });
        expect(split.workCents + split.surchargeCents, `${amount}/${known}`).toBe(total);
      }
    }
  });

  it("treats a payment with no fee on it as all work", () => {
    // Cash, a cheque, an old payment from before any of this existed.
    expect(splitPaidTotal({ totalCents: 50000, workCents: 50000 })).toEqual({
      workCents: 50000,
      surchargeCents: 0,
    });
  });

  it("refuses a claimed original larger than what arrived", () => {
    // That would make the surcharge negative, which would credit the client
    // with money nobody received.
    const split = splitPaidTotal({ totalCents: 10000, workCents: 20000 });
    expect(split.surchargeCents).toBeGreaterThanOrEqual(0);
    expect(split.workCents + split.surchargeCents).toBe(10000);
  });
});

describe("surchargeNotice", () => {
  it("names the money, not just the percentage", () => {
    // "3.5%" is arithmetic somebody has to do while holding a card.
    const notice = surchargeNotice(123456);
    expect(notice).toContain("$43.21");
    expect(notice).toContain("3.5%");
  });

  it("says what avoids it", () => {
    expect(surchargeNotice(100000)).toMatch(/cash or cheque/i);
  });
});

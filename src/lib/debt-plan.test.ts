import { describe, expect, it } from "vitest";

import { creditLimitFrom, DEFAULT_RESERVE, planDebt, type Card, type CashPicture } from "@/lib/debt-plan";

function card(over: Partial<Card> = {}): Card {
  return {
    id: "c1",
    name: "Card",
    mask: "1001",
    balance: 1000,
    creditLimit: 5000,
    apr: 20,
    minimumPayment: 50,
    dueDay: 15,
    ...over,
  };
}

function cash(over: Partial<CashPicture> = {}): CashPicture {
  return { inBank: 0, stripeIncoming: 0, receivable: 0, owedToCrew: 0, ...over };
}

/** The real shape of it: two Amex cards, two current accounts. */
const AMEX = [
  card({ id: "blue", name: "Blue Business Cash", balance: 3857.02, creditLimit: 3400, apr: 26.24, minimumPayment: 120, dueDay: 8 }),
  card({ id: "plat", name: "Business Platinum", balance: 15803.42, creditLimit: 15803.42, apr: 19.99, minimumPayment: 450, dueDay: 22 }),
];

describe("adding up what is owed", () => {
  it("totals the card balances", () => {
    expect(planDebt(AMEX, cash()).debt).toBeCloseTo(19660.44, 2);
  });

  it("totals what the statements demand", () => {
    expect(planDebt(AMEX, cash()).minimums).toBe(570);
  });

  it("ignores a card that is paid off", () => {
    const plan = planDebt([card({ balance: 0 }), card({ id: "c2", balance: 500 })], cash());
    expect(plan.debt).toBe(500);
  });

  it("never asks for a minimum bigger than the balance", () => {
    const plan = planDebt([card({ balance: 20, minimumPayment: 50 })], cash());
    expect(plan.minimums).toBe(20);
  });
});

describe("what is actually free to spend", () => {
  it("is the bank, less the crew, less the reserve", () => {
    const plan = planDebt(AMEX, cash({ inBank: 5000, owedToCrew: 1000 }), { reserve: 500 });
    expect(plan.payableToday).toBe(3500);
  });

  it("counts nothing that has not landed", () => {
    // An accepted proposal is not cash and a Stripe balance in transit is not
    // cash. Spending either is how a payroll run bounces.
    const plan = planDebt(AMEX, cash({ inBank: 1000, stripeIncoming: 9000, receivable: 20000 }), { reserve: 0 });
    expect(plan.payableToday).toBe(1000);
  });

  it("counts them in the second plan, which is the one to work towards", () => {
    const plan = planDebt(AMEX, cash({ inBank: 1000, stripeIncoming: 2000, receivable: 3000 }), { reserve: 0 });
    expect(plan.payableWhenPaid).toBe(6000);
  });

  it("is never negative, however far under water the account is", () => {
    const plan = planDebt(AMEX, cash({ inBank: 100, owedToCrew: 9000 }));
    expect(plan.payableToday).toBe(0);
    expect(plan.today).toEqual([]);
  });

  it("keeps something back by default rather than emptying the account", () => {
    expect(DEFAULT_RESERVE).toBeGreaterThan(0);
    expect(planDebt(AMEX, cash({ inBank: 1000 })).payableToday).toBe(1000 - DEFAULT_RESERVE);
  });
});

describe("who gets paid, and in what order", () => {
  it("pays the crew before any card", () => {
    // A card charges interest for being late. A person who is not paid stops
    // turning up, and is owed the money whatever the cards say.
    const plan = planDebt(AMEX, cash({ inBank: 2000, owedToCrew: 2000 }), { reserve: 0 });
    expect(plan.payableToday).toBe(0);
    expect(plan.today).toEqual([]);
  });

  it("covers every minimum before giving any card more", () => {
    const plan = planDebt(AMEX, cash({ inBank: 570 }), { reserve: 0 });
    const byId = new Map(plan.today.map((a) => [a.cardId, a.amount]));
    expect(byId.get("blue")).toBe(120);
    expect(byId.get("plat")).toBe(450);
  });

  it("covers the nearest deadline first when it cannot cover both", () => {
    // Blue is due on the 8th, Platinum on the 22nd.
    const plan = planDebt(AMEX, cash({ inBank: 200 }), { reserve: 0 });
    expect(plan.today.find((a) => a.cardId === "blue")?.amount).toBe(120);
  });

  it("puts everything spare against the dearest debt", () => {
    const plan = planDebt(AMEX, cash({ inBank: 1570 }), { reserve: 0 });
    const blue = plan.today.find((a) => a.cardId === "blue")!;
    // 120 minimum plus the whole 1,000 surplus, because Blue is at 26.24%.
    expect(blue.amount).toBe(1120);
    expect(plan.today.find((a) => a.cardId === "plat")?.amount).toBe(450);
  });

  it("moves to the next dearest once the first is cleared", () => {
    const plan = planDebt(AMEX, cash({ inBank: 6000 }), { reserve: 0 });
    const blue = plan.today.find((a) => a.cardId === "blue")!;
    expect(blue.amount).toBe(3857.02);
    expect(plan.today.find((a) => a.cardId === "plat")!.amount).toBeGreaterThan(450);
  });

  it("never pays a card more than it owes", () => {
    const plan = planDebt(AMEX, cash({ inBank: 100_000 }), { reserve: 0 });
    for (const line of plan.today) {
      const owed = AMEX.find((c) => c.id === line.cardId)!.balance;
      expect(line.amount).toBeLessThanOrEqual(owed + 1e-9);
    }
  });

  it("never allocates more than there is", () => {
    for (const inBank of [0, 137.5, 570, 4000, 25_000]) {
      const plan = planDebt(AMEX, cash({ inBank }), { reserve: 0 });
      const total = plan.today.reduce((sum, line) => sum + line.amount, 0);
      expect(total, `${inBank} in the bank`).toBeLessThanOrEqual(inBank + 1e-9);
    }
  });

  it("treats a card with no rate as the cheapest, not the dearest", () => {
    // Guessing high would send real money to a card on the strength of a
    // number nobody entered.
    const known = card({ id: "known", apr: 10, balance: 2000, minimumPayment: 0, dueDay: 1 });
    const unknown = card({ id: "unknown", apr: null, balance: 2000, minimumPayment: 0, dueDay: 2 });
    const plan = planDebt([unknown, known], cash({ inBank: 500 }), { reserve: 0 });
    expect(plan.today[0].cardId).toBe("known");
  });

  it("says why each card got what it got", () => {
    const plan = planDebt(AMEX, cash({ inBank: 1570 }), { reserve: 0 });
    for (const line of plan.today) expect(line.why.length).toBeGreaterThan(0);
    expect(plan.today.find((a) => a.cardId === "plat")?.why).toContain("22nd");
  });
});

describe("what is about to go wrong", () => {
  it("leads with wages that cannot be met", () => {
    const plan = planDebt(AMEX, cash({ inBank: 500, owedToCrew: 3000 }));
    expect(plan.warnings[0].level).toBe("urgent");
    expect(plan.warnings[0].message).toMatch(/crew is owed/i);
  });

  it("says when the minimums cannot be covered, and by how much", () => {
    const plan = planDebt(AMEX, cash({ inBank: 300 }), { reserve: 0 });
    const short = plan.warnings.find((w) => w.message.includes("short by"));
    expect(short?.message).toContain("$270");
  });

  it("says when a card is over its limit", () => {
    // Blue is at $3,857 on a $3,400 limit, which is the real state of it.
    const plan = planDebt(AMEX, cash({ inBank: 50_000 }));
    expect(plan.warnings.some((w) => /over its limit/.test(w.message))).toBe(true);
  });

  it("says when a card is nearly full, without calling it urgent", () => {
    const nearly = card({ balance: 4200, creditLimit: 5000, minimumPayment: 0 });
    const plan = planDebt([nearly], cash({ inBank: 50_000 }));
    const watch = plan.warnings.find((w) => /% of its limit/.test(w.message));
    expect(watch?.level).toBe("watch");
  });

  it("says which cards it could not plan for", () => {
    const bare = card({ id: "bare", name: "Unknown Card", apr: null, minimumPayment: null });
    const plan = planDebt([bare], cash({ inBank: 5000 }));
    expect(plan.warnings.some((w) => w.message.includes("Unknown Card"))).toBe(true);
  });

  it("is quiet when everything is in order", () => {
    const healthy = card({ balance: 500, creditLimit: 10_000, apr: 15, minimumPayment: 25, dueDay: 10 });
    expect(planDebt([healthy], cash({ inBank: 9000 })).warnings).toEqual([]);
  });
});

describe("how full each card is", () => {
  it("reports the fraction used", () => {
    const plan = planDebt([card({ balance: 2500, creditLimit: 5000 })], cash());
    expect(plan.utilisation[0].used).toBeCloseTo(0.5, 6);
  });

  it("says nothing rather than guessing when the limit is unknown", () => {
    const plan = planDebt([card({ creditLimit: null })], cash());
    expect(plan.utilisation[0].used).toBeNull();
  });
});

describe("with nothing to plan", () => {
  it("copes with no cards", () => {
    const plan = planDebt([], cash({ inBank: 5000 }));
    expect(plan.debt).toBe(0);
    expect(plan.today).toEqual([]);
    expect(plan.warnings).toEqual([]);
  });

  it("copes with no money", () => {
    const plan = planDebt(AMEX, cash());
    expect(plan.payableToday).toBe(0);
    expect(plan.today).toEqual([]);
  });
});

describe("working out a card's limit", () => {
  it("takes what somebody typed in from the statement", () => {
    expect(creditLimitFrom(5000, 1000, 2000)).toBe(5000);
  });

  it("derives it from what is owed plus what is left, when nobody has", () => {
    // The bank sends no limit but does send the credit remaining, and the two
    // together are the limit. This is what turns "you owe $3,857" into "you
    // are $458 over your limit".
    expect(creditLimitFrom(null, 3857.02, -458)).toBeCloseTo(3399.02, 2);
    expect(creditLimitFrom(null, 1000, 4000)).toBe(5000);
  });

  it("says nothing rather than guessing when the feed is silent", () => {
    expect(creditLimitFrom(null, 1000, null)).toBeNull();
  });

  it("refuses a derived limit that comes out at nothing", () => {
    expect(creditLimitFrom(null, 0, 0)).toBeNull();
    expect(creditLimitFrom(null, 100, -500)).toBeNull();
  });

  it("catches the real card being over its limit", () => {
    const over = creditLimitFrom(null, 3857.02, -458)!;
    expect(3857.02).toBeGreaterThan(over);
  });
});

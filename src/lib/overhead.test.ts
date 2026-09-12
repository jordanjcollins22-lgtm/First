import { describe, expect, it } from "vitest";

import { groupFor, overheadFrom, overheadPerHour, type Countable } from "@/lib/overhead";

function charge(over: Partial<Countable> = {}): Countable {
  return {
    key: "k",
    label: "Something",
    kind: "obligation",
    cadence: "monthly",
    typicalAmount: 100,
    monthlyAmount: 100,
    variation: 0.1,
    variableAmount: false,
    hits: 5,
    firstSeen: "2026-04-01",
    lastSeen: "2026-09-01",
    dayOfMonth: 1,
    confidence: 0.9,
    accountId: null,
    transactionIds: [],
    ...over,
  };
}

describe("which bucket a charge falls in", () => {
  it("takes what somebody said over anything it could work out", () => {
    // A landlord's trading name says nothing about being rent, so the biggest
    // line in the business lands in "everything else" until a person says so.
    expect(groupFor({ label: "YSI Fieldside Gr MD", kind: "obligation" }, "OTHER")).toBe("other");
    expect(groupFor({ label: "YSI Fieldside Gr MD", kind: "obligation" }, "OTHER", "premises")).toBe(
      "premises"
    );
  });

  it("reads rent when the name actually says it", () => {
    expect(groupFor({ label: "Buck Rentals LLC", kind: "obligation" }, null)).toBe("premises");
  });

  it("knows an insurer", () => {
    expect(groupFor({ label: "State Farm", kind: "obligation" }, null)).toBe("insurance");
    expect(groupFor({ label: "Tesla Property & Cas", kind: "obligation" }, null)).toBe("insurance");
  });

  it("puts a truck lease with the vehicles, not the premises", () => {
    // "lease" reads as premises on its own, so the vehicle words have to win
    // or a truck payment lands under rent.
    expect(groupFor({ label: "CAF DIRECT CHECK AUTO LEASE", kind: "obligation" }, null)).toBe(
      "vehicles"
    );
  });

  it("keeps the phone apart from the power, because they move for different reasons", () => {
    // Gas and electricity swing with the weather and how much is running; the
    // phone bill does not. One figure covering both says nothing about either.
    expect(groupFor({ label: "Comcast", kind: "obligation" }, null)).toBe("phone");
    expect(groupFor({ label: "Verizon Wireless", kind: "obligation" }, null)).toBe("phone");
    expect(groupFor({ label: "BALTIMORE GAS AN BILLPAY", kind: "obligation" }, null)).toBe("power");
  });

  it("puts water and waste together, since the landlord often bills them as one", () => {
    expect(groupFor({ label: "Solid Waste Esl", kind: "obligation" }, null)).toBe("water");
    expect(groupFor({ label: "City Water Dept", kind: "obligation" }, null)).toBe("water");
  });

  it("will not guess from the bank's catch-all category", () => {
    // Plaid puts rent, power, water and the phone in one bucket, so it can
    // only ever be the fallback for a name that said nothing — and guessing
    // wrongly here is worse than admitting it is unsorted.
    expect(groupFor({ label: "Anything At All", kind: "obligation" }, "RENT_AND_UTILITIES")).toBe(
      "other"
    );
  });

  it("uses the category where the name says nothing", () => {
    // A card fee has no name worth reading and a perfect category.
    expect(groupFor({ label: "0000", kind: "obligation" }, "BANK_FEES")).toBe("finance");
  });

  it("treats anything that bills like software as software", () => {
    expect(groupFor({ label: "Spotify", kind: "subscription" }, null)).toBe("software");
  });

  it("falls back rather than guessing", () => {
    expect(groupFor({ label: "Mystery", kind: "obligation" }, "OTHER")).toBe("other");
  });
});

describe("the overhead", () => {
  it("adds up what is left after a person has looked at it", () => {
    const breakdown = overheadFrom([
      charge({ key: "rent", label: "YSI Fieldside", monthlyAmount: 2543.89, group: "premises" }),
      charge({ key: "spotify", label: "Spotify", kind: "subscription", monthlyAmount: 20.13 }),
    ]);
    expect(breakdown.monthly).toBe(2564.02);
    expect(breakdown.yearly).toBe(30768.24);
  });

  it("never counts a transfer, which would double what jobs are priced to cover", () => {
    const breakdown = overheadFrom([charge({ kind: "transfer", monthlyAmount: 5000 })]);
    expect(breakdown.monthly).toBe(0);
  });

  it("leaves out anything somebody pushed away as not an overhead", () => {
    const breakdown = overheadFrom([charge({ monthlyAmount: 400, dismissed: true })]);
    expect(breakdown.monthly).toBe(0);
  });

  it("leaves out anything that stopped being charged", () => {
    const breakdown = overheadFrom([charge({ monthlyAmount: 400, live: false })]);
    expect(breakdown.monthly).toBe(0);
  });

  it("groups it, because one figure is a fact and a breakdown is a decision", () => {
    const breakdown = overheadFrom([
      charge({ key: "rent", label: "YSI Fieldside", monthlyAmount: 2500, group: "premises" }),
      charge({ key: "spot", label: "Spotify", kind: "subscription", monthlyAmount: 20 }),
      charge({ key: "hl", label: "HighLevel", kind: "subscription", monthlyAmount: 500 }),
    ]);
    const software = breakdown.groups.find((g) => g.group === "software");
    expect(software?.monthly).toBe(520);
    // Biggest first inside a group, so the thing worth cutting leads.
    expect(software?.lines[0].label).toBe("HighLevel");
  });

  it("keeps the groups in a fixed order rather than by size", () => {
    // The list is read to find something to cut, and what cannot be cut goes
    // first so a reader scans past it to the software.
    const breakdown = overheadFrom([
      charge({ key: "spot", label: "Spotify", kind: "subscription", monthlyAmount: 9000 }),
      charge({ key: "rent", label: "YSI Fieldside", monthlyAmount: 10, group: "premises" }),
    ]);
    expect(breakdown.groups.map((g) => g.group)).toEqual(["premises", "software"]);
  });

  it("says how much of the total is an average of something that moves", () => {
    // Rent that was 131 one month and 2,790 the next is not a fixed bill, and
    // treating it as one is how a forecast goes wrong.
    const breakdown = overheadFrom([
      charge({ key: "rent", monthlyAmount: 750, variableAmount: true }),
      charge({ key: "spot", monthlyAmount: 250, kind: "subscription" }),
    ]);
    expect(breakdown.variableShare).toBe(0.75);
  });

  it("comes back at nothing for nothing", () => {
    const breakdown = overheadFrom([]);
    expect(breakdown.monthly).toBe(0);
    expect(breakdown.groups).toEqual([]);
    expect(breakdown.variableShare).toBe(0);
  });
});

describe("what an hour has to carry", () => {
  it("spreads the overhead across the hours that can be billed", () => {
    expect(overheadPerHour(4500, 300)).toBe(15);
  });

  it("refuses to divide by no hours rather than returning infinity", () => {
    expect(overheadPerHour(4500, 0)).toBeNull();
  });
});

describe("what a charge actually covers", () => {
  it("carries a note through, because the bank cannot say what is bundled", () => {
    // The rent line is rent plus the water some months. A figure that does not
    // admit that reads as pure rent and gets budgeted against wrongly.
    const breakdown = overheadFrom([
      charge({ group: "premises", note: "Includes the water some months" }),
    ]);
    expect(breakdown.groups[0].lines[0].note).toBe("Includes the water some months");
  });
});

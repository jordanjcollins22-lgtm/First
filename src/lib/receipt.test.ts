import { describe, expect, it } from "vitest";

import {
  addressLines,
  balanceLine,
  canIssue,
  longDay,
  money,
  nextSequence,
  receiptFileName,
  receiptLine,
  receiptNumber,
  RECEIPT_HEADLINE,
  type Receipt,
} from "@/lib/receipt";

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    number: "R-2026-0001",
    amountCents: 45_000,
    receivedAt: "2026-09-11T15:30:00Z",
    method: "check",
    payerName: "Pat Rivera",
    forWhat: "Front beds and mulch",
    address: "208 Crafton Rd",
    businessName: "J's Landscaping Services LLC",
    business: { phone: null, email: null, address: null, website: null, logoUrl: null },
    reference: "Check 1042",
    note: null,
    outstandingCents: null,
    ...overrides,
  };
}

describe("receiptNumber", () => {
  it("puts the year first so a year files together", () => {
    expect(receiptNumber(2026, 7)).toBe("R-2026-0007");
  });

  it("pads to four, which is more than a year will ever need", () => {
    expect(receiptNumber(2026, 1234)).toBe("R-2026-1234");
    expect(receiptNumber(2026, 12345)).toBe("R-2026-12345");
  });

  it("never writes a zeroth receipt", () => {
    expect(receiptNumber(2026, 0)).toBe("R-2026-0001");
    expect(receiptNumber(2026, -5)).toBe("R-2026-0001");
  });
});

describe("nextSequence", () => {
  it("carries on from the highest already issued", () => {
    expect(nextSequence(["R-2026-0001", "R-2026-0004", "R-2026-0002"], 2026)).toBe(5);
  });

  it("starts a new year at one", () => {
    // Last year's numbers are not this year's, so January starts over.
    expect(nextSequence(["R-2025-0099"], 2026)).toBe(1);
  });

  it("ignores anything that is not one of ours", () => {
    expect(nextSequence(["INV-3", "", "R-2026-0002"], 2026)).toBe(3);
  });

  it("starts at one with nothing on file", () => {
    expect(nextSequence([], 2026)).toBe(1);
  });
});

describe("what the receipt says", () => {
  it("says it in the past tense and asks for nothing", () => {
    // An invoice asks. A receipt confirms. A client looking at one has
    // already paid, and being asked again is alarming.
    expect(RECEIPT_HEADLINE).toBe("Payment received, thank you");
    expect(RECEIPT_HEADLINE).not.toMatch(/due|pay now|please pay/i);
  });

  it("says what arrived, how, and when in one sentence", () => {
    expect(receiptLine(receipt())).toBe("$450.00 received by check on Friday, September 11, 2026.");
  });

  it("names the method the way a person would", () => {
    expect(receiptLine(receipt({ method: "transfer" }))).toMatch(/by bank transfer/);
  });
});

describe("balanceLine", () => {
  it("says nothing at all when nobody knows the balance", () => {
    // A receipt is not the document to guess on. "$0 outstanding" on a job
    // nobody has totalled tells the client they are paid up, and they will
    // hold us to it.
    expect(balanceLine(receipt({ outstandingCents: null }))).toBeNull();
  });

  it("says so plainly when the job is settled", () => {
    expect(balanceLine(receipt({ outstandingCents: 0 }))).toMatch(/in full/);
  });

  it("names what is left without asking for it", () => {
    const line = balanceLine(receipt({ outstandingCents: 120_000 }))!;
    expect(line).toMatch(/\$1,200\.00 remains/);
    expect(line).not.toMatch(/pay now|click/i);
  });

  it("treats an overpayment as settled rather than as a negative", () => {
    expect(balanceLine(receipt({ outstandingCents: -500 }))).toMatch(/in full/);
  });
});

describe("canIssue", () => {
  it("writes one for money that actually arrived", () => {
    expect(canIssue({ amountCents: 45_000, receivedAt: "2026-09-11T15:30:00Z" })).toBe(true);
  });

  it("refuses a payment of nothing", () => {
    expect(canIssue({ amountCents: 0, receivedAt: "2026-09-11T15:30:00Z" })).toBe(false);
  });

  it("refuses a refund, which is not a receipt", () => {
    expect(canIssue({ amountCents: -4_500, receivedAt: "2026-09-11T15:30:00Z" })).toBe(false);
  });

  it("refuses one with no date on it", () => {
    expect(canIssue({ amountCents: 45_000, receivedAt: null })).toBe(false);
    expect(canIssue({ amountCents: 45_000, receivedAt: "whenever" })).toBe(false);
  });
});

describe("receiptFileName", () => {
  it("names the file after the receipt and who paid", () => {
    expect(receiptFileName(receipt())).toBe("R-2026-0001-Pat-Rivera.pdf");
  });

  it("copes with a payer we have no name for", () => {
    expect(receiptFileName(receipt({ payerName: null }))).toBe("R-2026-0001.pdf");
  });

  it("does not put punctuation from a name into a filename", () => {
    expect(receiptFileName(receipt({ payerName: "O'Brien & Sons, LLC" }))).toBe(
      "R-2026-0001-O-Brien-Sons-LLC.pdf"
    );
  });
});

describe("money and dates", () => {
  it("always shows the cents, because a receipt is a record", () => {
    expect(money(45_000)).toBe("$450.00");
    expect(money(45_050)).toBe("$450.50");
  });

  it("writes a date somebody would read aloud", () => {
    expect(longDay("2026-09-11T15:30:00Z")).toBe("Friday, September 11, 2026");
  });

  it("writes nothing for a date that is not one", () => {
    expect(longDay("not a date")).toBe("");
  });
});

describe("addressLines", () => {
  it("prints an address exactly as it was typed, line for line", () => {
    expect(addressLines({ address: "3501 Woodbrook Court\nAbingdon, MD 21009" })).toEqual([
      "3501 Woodbrook Court",
      "Abingdon, MD 21009",
    ]);
  });

  it("keeps city, state and zip together when the address was typed on one line", () => {
    // "Bel Air, MD 21014" is one line by every convention a client has seen.
    // Splitting it at every comma printed the state on a line of its own.
    expect(addressLines({ address: "12 Main St, Bel Air, MD 21014" })).toEqual([
      "12 Main St",
      "Bel Air, MD 21014",
    ]);
  });

  it("leaves an address with no comma as one line", () => {
    expect(addressLines({ address: "PO Box 9" })).toEqual(["PO Box 9"]);
  });

  it("prints nothing for no address", () => {
    expect(addressLines({ address: null })).toEqual([]);
    expect(addressLines({ address: "  " })).toEqual([]);
  });
});

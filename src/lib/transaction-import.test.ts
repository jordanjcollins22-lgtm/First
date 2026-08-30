import { describe, expect, it } from "vitest";

import {
  isSettled,
  normaliseStatus,
  parseDate,
  parseMoneyCents,
  parseTransactionCsv,
  previewTransactions,
  type TransactionDraft,
} from "./transaction-import";

function draft(over: Partial<TransactionDraft> = {}): TransactionDraft {
  return {
    externalId: "t1",
    name: "Dana Ruiz",
    email: "dana@example.com",
    phone: null,
    amountCents: 420000,
    paidOn: "2026-03-04",
    status: "succeeded",
    description: "Back garden rebuild",
    method: "card",
    ...over,
  };
}

describe("parseMoneyCents", () => {
  it("reads the shapes an export actually writes", () => {
    expect(parseMoneyCents("1200")).toBe(120000);
    expect(parseMoneyCents("$1,200.00")).toBe(120000);
    expect(parseMoneyCents("1200.50")).toBe(120050);
    expect(parseMoneyCents(" USD 1,200 ")).toBe(120000);
  });

  it("reads a refund written in brackets, and one written with a minus", () => {
    expect(parseMoneyCents("(1,200.00)")).toBe(-120000);
    expect(parseMoneyCents("-1200")).toBe(-120000);
  });

  it("works in cents, so adding a column of these cannot drift", () => {
    expect(parseMoneyCents("0.10")).toBe(10);
    expect(parseMoneyCents("0.07")).toBe(7);
  });

  it("gives nothing back for a blank or a word", () => {
    expect(parseMoneyCents("")).toBeNull();
    expect(parseMoneyCents(undefined)).toBeNull();
    expect(parseMoneyCents("n/a")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads an ISO day and an ISO timestamp", () => {
    expect(parseDate("2026-03-04")).toBe("2026-03-04");
    expect(parseDate("2026-03-04T15:00:00Z")).toBe("2026-03-04");
  });

  it("reads the US order an export writes", () => {
    expect(parseDate("3/4/2026")).toBe("2026-03-04");
    expect(parseDate("03/04/26")).toBe("2026-03-04");
  });

  it("gives nothing back rather than filing it under today", () => {
    // A wrong date looks like an answer, which is worse than no date.
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("normaliseStatus", () => {
  it("knows money we have from money we do not", () => {
    for (const word of ["succeeded", "Success", "Paid", "completed", "captured", "Won"]) {
      expect(normaliseStatus(word)).toBe("succeeded");
    }
    for (const word of ["refunded", "Chargeback", "reversed"]) {
      expect(normaliseStatus(word)).toBe("refunded");
    }
    for (const word of ["failed", "Declined", "voided", "cancelled"]) {
      expect(normaliseStatus(word)).toBe("failed");
    }
    for (const word of ["pending", "Processing", "unpaid"]) {
      expect(normaliseStatus(word)).toBe("pending");
    }
  });

  it("says it does not know rather than guessing", () => {
    expect(normaliseStatus("bananas")).toBe("unknown");
    expect(normaliseStatus("")).toBe("unknown");
  });
});

describe("isSettled", () => {
  it("is only money we actually have", () => {
    expect(isSettled(draft())).toBe(true);
    expect(isSettled(draft({ status: "refunded" }))).toBe(false);
    expect(isSettled(draft({ status: "pending" }))).toBe(false);
  });

  it("is not a negative row, whatever its status says", () => {
    // A refund exported with a "paid" status must never mark a job paid.
    expect(isSettled(draft({ amountCents: -420000 }))).toBe(false);
  });
});

describe("parseTransactionCsv", () => {
  const csv = [
    "Transaction ID,Customer Name,Email,Amount,Date,Status,Product",
    "ch_1,Dana Ruiz,dana@example.com,\"$4,200.00\",3/4/2026,Succeeded,Back garden",
    "ch_2,Mark Ellis,mark@example.com,1850,2026-06-02,Refunded,Front beds",
  ].join("\n");

  it("reads a file it has never seen before", () => {
    const report = parseTransactionCsv(csv);
    expect(report.drafts).toHaveLength(2);
    expect(report.unmatchedHeaders).toEqual([]);
    expect(report.drafts[0]).toMatchObject({
      externalId: "ch_1",
      name: "Dana Ruiz",
      amountCents: 420000,
      paidOn: "2026-03-04",
      status: "succeeded",
    });
  });

  it("reports a column nothing claimed rather than losing it", () => {
    const report = parseTransactionCsv("Amount,Email,Sales Rep\n100,a@b.com,Jo");
    expect(report.unmatchedHeaders).toEqual(["Sales Rep"]);
  });

  it("skips a row with no amount, and says which", () => {
    const report = parseTransactionCsv("Email,Amount\na@b.com,\nb@c.com,50");
    expect(report.drafts).toHaveLength(1);
    expect(report.skipped[0]).toMatchObject({ row: 2 });
  });

  it("skips a row with nothing to match a client on", () => {
    // An orphan payment nobody can attribute is worse than a reported skip.
    const report = parseTransactionCsv("Amount,Date\n50,2026-01-01");
    expect(report.drafts).toHaveLength(0);
    expect(report.skipped[0].reason).toMatch(/match a client/i);
  });

  it("says so plainly for an empty file", () => {
    expect(parseTransactionCsv("").skipped[0].reason).toMatch(/no rows/i);
  });

  it("ignores a blank line in the middle", () => {
    const report = parseTransactionCsv("Email,Amount\na@b.com,50\n\nb@c.com,60");
    expect(report.drafts).toHaveLength(2);
  });
});

describe("previewTransactions", () => {
  it("says what the file will actually do before anybody presses import", () => {
    const preview = previewTransactions([
      draft(),
      draft({ externalId: "t2", status: "refunded", amountCents: -100000 }),
      draft({ externalId: "t3", status: "failed" }),
      draft({ externalId: "t4", paidOn: null }),
    ]);
    expect(preview).toMatchObject({ total: 4, settled: 2, refunded: 1, failed: 1, undated: 1 });
    expect(preview.settledCents).toBe(840000);
  });

  it("is empty for an empty file", () => {
    expect(previewTransactions([])).toMatchObject({ total: 0, settled: 0, settledCents: 0 });
  });
});

describe("the status words that look like their own opposite", () => {
  it("does not read 'unpaid' as paid", () => {
    // "unpaid" contains "paid". Reading it as money received is the mistake
    // that marks an unpaid job settled and moves it down the pipeline.
    expect(normaliseStatus("unpaid")).toBe("pending");
    expect(normaliseStatus("Unpaid")).toBe("pending");
  });

  it("does not read a partial refund as a payment", () => {
    expect(normaliseStatus("partially refunded")).toBe("refunded");
  });

  it("does not read a failed capture as a capture", () => {
    expect(normaliseStatus("capture failed")).toBe("failed");
  });

  it("still reads the ordinary success words", () => {
    expect(normaliseStatus("Paid")).toBe("succeeded");
    expect(normaliseStatus("payment succeeded")).toBe("succeeded");
  });
});

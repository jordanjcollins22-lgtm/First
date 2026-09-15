import { describe, expect, it } from "vitest";
import { methodDetail, paymentMethod } from "./payment-method";

describe("paymentMethod", () => {
  // Every distinct value in the real transactions export. All of them have to
  // land on one of the four the column allows, because one that does not takes
  // the whole batch down rather than the single row.
  const REAL_FILE = [
    "Credit Card",
    "Debit Card",
    "Cheque",
    "Other",
    "Cash",
    "Us Bank Account",
    "Prepaid Card",
    "Bank Transfer",
    "",
  ];

  it("folds every value the real export uses into the four allowed", () => {
    const allowed = new Set(["card", "cash", "check", "other"]);
    for (const raw of REAL_FILE) {
      expect(allowed.has(paymentMethod(raw)), `${raw || "(blank)"} → ${paymentMethod(raw)}`).toBe(
        true
      );
    }
  });

  it("reads the card rails as card", () => {
    expect(paymentMethod("Credit Card")).toBe("card");
    expect(paymentMethod("Debit Card")).toBe("card");
    expect(paymentMethod("Prepaid Card")).toBe("card");
    expect(paymentMethod("visa")).toBe("card");
  });

  it("reads both spellings of a cheque", () => {
    expect(paymentMethod("Cheque")).toBe("check");
    expect(paymentMethod("Check")).toBe("check");
  });

  it("reads cash", () => {
    expect(paymentMethod("Cash")).toBe("cash");
  });

  it("sends a bank transfer to other rather than guessing at it", () => {
    // There is no ACH value on the column. Calling it a card would be a wrong
    // answer on a bank statement, so it is an unspecific one instead.
    expect(paymentMethod("Us Bank Account")).toBe("other");
    expect(paymentMethod("Bank Transfer")).toBe("other");
  });

  it("treats a blank cell as other rather than as a card", () => {
    // Forty rows in the real file have nothing here. The column defaults to
    // 'card', and forty payments claiming to be card payments is a made-up
    // answer.
    expect(paymentMethod("")).toBe("other");
    expect(paymentMethod(null)).toBe("other");
    expect(paymentMethod(undefined)).toBe("other");
  });
});

describe("methodDetail", () => {
  it("keeps what the export said when the four values lose it", () => {
    expect(methodDetail("Debit Card")).toBe("Debit Card");
    expect(methodDetail("Us Bank Account")).toBe("Us Bank Account");
  });

  it("says nothing when the wording added nothing", () => {
    expect(methodDetail("Cash")).toBeNull();
    expect(methodDetail("Other")).toBeNull();
    expect(methodDetail("")).toBeNull();
  });
});

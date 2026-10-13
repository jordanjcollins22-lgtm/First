import { describe, expect, it } from "vitest";

import { contentHash, customerBody, displayName, invoiceBody, MAX_ATTEMPTS, paymentBody, qboQuote, requestIdFor, shouldPush } from "./map";

describe("QuickBooks shapes", () => {
  it("cleans a display name", () => {
    expect(displayName({ id: "abcdef123", name: "Smith: John\tJr" })).toBe("Smith John Jr");
    expect(displayName({ id: "abcdef123", name: "" })).toBe("Client abcdef12");
  });
  it("builds a customer with only what is known", () => {
    expect(customerBody({ id: "1", name: "Jo", email: "jo@x.com", phone: null, address: null })).toEqual({
      DisplayName: "Jo",
      PrimaryEmailAddr: { Address: "jo@x.com" },
    });
  });
  it("books an invoice to the sales item", () => {
    const body = invoiceBody(
      { id: "i", customerId: "c", amount: 1234.567, description: "Patio", txnDate: "2026-10-01", dueDate: null, docNumber: "JS-12", voided: false },
      "42",
      "1"
    );
    expect(body.CustomerRef).toEqual({ value: "42" });
    expect(body.DocNumber).toBe("JS-12");
    const line = (body.Line as { Amount: number; SalesItemLineDetail: { ItemRef: { value: string } } }[])[0];
    expect(line.Amount).toBe(1234.57);
    expect(line.SalesItemLineDetail.ItemRef.value).toBe("1");
  });
  it("applies a payment to its invoice when there is one", () => {
    const p = { id: "p", customerId: "c", amount: 50, txnDate: "2026-10-02", method: "card", invoiceId: "i", reference: "R-2026-0001" };
    expect(paymentBody(p, "42", "77").Line).toEqual([{ Amount: 50, LinkedTxn: [{ TxnId: "77", TxnType: "Invoice" }] }]);
    expect(paymentBody(p, "42", null).Line).toBeUndefined();
  });
  it("quotes for QBO queries", () => {
    expect(qboQuote("O'Brien")).toBe("'O\\'Brien'");
  });
});

describe("idempotency", () => {
  it("gives the same request id for the same record, and fits Intuit's limit", () => {
    const a = requestIdFor("org", "invoice", "x");
    expect(a).toBe(requestIdFor("org", "invoice", "x"));
    expect(a).not.toBe(requestIdFor("org", "invoice", "y"));
    expect(a.length).toBeLessThanOrEqual(50);
  });
  it("creates once, skips the unchanged, updates the changed", () => {
    const h = contentHash({ a: 1 });
    expect(shouldPush(undefined, h)).toBe("create");
    expect(shouldPush({ qbo_id: "5", content_hash: h, attempts: 0, last_error: null }, h)).toBe("skip");
    expect(shouldPush({ qbo_id: "5", content_hash: "old", attempts: 0, last_error: null }, h)).toBe("update");
  });
  it("stops retrying a record that keeps failing", () => {
    const h = contentHash({ a: 1 });
    expect(shouldPush({ qbo_id: null, content_hash: null, attempts: 2, last_error: "x" }, h)).toBe("create");
    expect(shouldPush({ qbo_id: null, content_hash: null, attempts: MAX_ATTEMPTS, last_error: "x" }, h)).toBe("skip");
  });
});

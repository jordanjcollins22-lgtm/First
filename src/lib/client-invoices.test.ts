import { describe, expect, it } from "vitest";
import {
  byUrgency,
  checkInvoiceFile,
  daysOverdue,
  invoiceLine,
  invoiceStatus,
  numberFromFileName,
  summariseInvoices,
  type ClientInvoice,
} from "./client-invoices";

const TODAY = new Date("2026-06-15T09:00:00.000Z");

const inv = (over: Partial<ClientInvoice> = {}): ClientInvoice => ({
  id: "i1",
  customerId: "c1",
  customerName: "Jane Smith",
  filePath: "org/c1/x.pdf",
  fileName: "invoice_1042.pdf",
  invoiceNumber: "1042",
  amount: 1200,
  issuedOn: "2026-05-01",
  dueOn: "2026-05-31",
  paidOn: null,
  notes: null,
  ...over,
});

describe("invoiceStatus", () => {
  it("calls a bill past its due date overdue", () => {
    expect(invoiceStatus(inv({ dueOn: "2026-05-31" }), TODAY)).toBe("overdue");
  });

  it("calls one settled late paid, not overdue", () => {
    // Money already in the bank is not something to keep shouting about.
    expect(invoiceStatus(inv({ dueOn: "2026-05-31", paidOn: "2026-06-10" }), TODAY)).toBe("paid");
  });

  it("warns on the week before it is due", () => {
    expect(invoiceStatus(inv({ dueOn: "2026-06-20" }), TODAY)).toBe("due-soon");
  });

  it("leaves one due further out alone", () => {
    expect(invoiceStatus(inv({ dueOn: "2026-07-30" }), TODAY)).toBe("outstanding");
  });

  it("does not call something due today overdue", () => {
    // Due today is due today. It goes late tomorrow.
    expect(invoiceStatus(inv({ dueOn: "2026-06-15" }), TODAY)).toBe("due-soon");
  });

  it("says so plainly when there is no due date to judge it by", () => {
    expect(invoiceStatus(inv({ dueOn: null }), TODAY)).toBe("undated");
  });

  it("does not invent a status from an unreadable date", () => {
    expect(invoiceStatus(inv({ dueOn: "not a date" }), TODAY)).toBe("undated");
  });
});

describe("daysOverdue", () => {
  it("counts the days since it was due", () => {
    expect(daysOverdue(inv({ dueOn: "2026-06-01" }), TODAY)).toBe(14);
  });

  it("is zero for anything not overdue", () => {
    expect(daysOverdue(inv({ dueOn: "2026-07-01" }), TODAY)).toBe(0);
    expect(daysOverdue(inv({ paidOn: "2026-06-02" }), TODAY)).toBe(0);
  });
});

describe("summariseInvoices", () => {
  it("separates what is owed from what came in", () => {
    const s = summariseInvoices(
      [
        inv({ id: "a", amount: 1000, paidOn: "2026-05-20" }),
        inv({ id: "b", amount: 500, dueOn: "2026-05-01" }),
        inv({ id: "c", amount: 250, dueOn: "2026-08-01" }),
      ],
      TODAY
    );
    expect(s.total).toBe(3);
    expect(s.paid).toBe(1);
    expect(s.outstanding).toBe(2);
    expect(s.overdue).toBe(1);
    expect(s.billedCents).toBe(175000);
    expect(s.paidCents).toBe(100000);
    expect(s.owedCents).toBe(75000);
  });

  it("counts an invoice with no amount without treating it as zero owed", () => {
    // It is still outstanding; we just cannot say for how much.
    const s = summariseInvoices([inv({ amount: null, dueOn: "2026-05-01" })], TODAY);
    expect(s.outstanding).toBe(1);
    expect(s.overdue).toBe(1);
    expect(s.owedCents).toBe(0);
  });

  it("does arithmetic in cents", () => {
    const s = summariseInvoices([inv({ amount: 0.1 }), inv({ id: "b", amount: 0.2 })], TODAY);
    expect(s.billedCents).toBe(30);
  });
});

describe("invoiceLine", () => {
  it("leads with what is owed", () => {
    const line = invoiceLine(summariseInvoices([inv({ amount: 500, dueOn: "2026-05-01" })], TODAY));
    expect(line).toMatch(/\$500 outstanding/);
    expect(line).toMatch(/1 overdue/);
  });

  it("says nothing about money when no amount was typed in", () => {
    const line = invoiceLine(summariseInvoices([inv({ amount: null, dueOn: "2026-05-01" })], TODAY));
    expect(line).toMatch(/1 outstanding/);
    expect(line).not.toMatch(/\$0/);
  });

  it("has something to say about an empty list", () => {
    expect(invoiceLine(summariseInvoices([], TODAY))).toMatch(/no invoices/i);
  });
});

describe("byUrgency", () => {
  it("puts the money owed longest at the top and the paid at the bottom", () => {
    const out = byUrgency(
      [
        inv({ id: "paid", paidOn: "2026-06-01" }),
        inv({ id: "future", dueOn: "2026-09-01" }),
        inv({ id: "late-recent", dueOn: "2026-06-01" }),
        inv({ id: "late-old", dueOn: "2026-02-01" }),
        inv({ id: "soon", dueOn: "2026-06-18" }),
      ],
      TODAY
    );
    expect(out.map((o) => o.id)).toEqual(["late-old", "late-recent", "soon", "future", "paid"]);
  });

  it("sinks an undated invoice below the ones that can be judged", () => {
    const out = byUrgency([inv({ id: "undated", dueOn: null }), inv({ id: "future", dueOn: "2026-09-01" })], TODAY);
    expect(out.map((o) => o.id)).toEqual(["future", "undated"]);
  });
});

describe("checkInvoiceFile", () => {
  it("accepts a PDF", () => {
    expect(checkInvoiceFile({ type: "application/pdf", size: 1024 }).ok).toBe(true);
  });

  it("reports everything wrong at once", () => {
    const check = checkInvoiceFile({ type: "text/plain", size: 30 * 1024 * 1024 });
    expect(check.ok).toBe(false);
    expect(check.message).toMatch(/PDF/);
    expect(check.message).toMatch(/limit/);
  });

  it("refuses an empty file", () => {
    expect(checkInvoiceFile({ type: "application/pdf", size: 0 }).ok).toBe(false);
  });
});

describe("numberFromFileName", () => {
  it("reads the number out of the usual names", () => {
    expect(numberFromFileName("invoice_1042.pdf")).toBe("1042");
    expect(numberFromFileName("INV-2291.pdf")).toBe("2291");
    expect(numberFromFileName("Invoice #A-155.pdf")).toBe("A-155");
  });

  it("reads a file named nothing but a number", () => {
    expect(numberFromFileName("1042.pdf")).toBe("1042");
  });

  it("offers nothing rather than a guess", () => {
    // A wrong value that looks filled in is worse than an empty field.
    expect(numberFromFileName("scan.pdf")).toBeNull();
    expect(numberFromFileName("final_copy.pdf")).toBeNull();
  });
});

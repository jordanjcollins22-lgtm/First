import { describe, expect, it } from "vitest";
import type { InvoicePlan } from "./client-invoices";
import {
  byUrgency,
  checkInvoiceFile,
  daysOverdue,
  invoiceLine,
  invoiceStatus,
  numberFromFileName,
  owedCents,
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
  title: null,
  scopeHtml: null,
  sourceStatus: null,
  plan: null,
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

describe("an invoice with a payment plan on it", () => {
  const plan = (over: Partial<InvoicePlan> = {}): InvoicePlan => ({
    id: "pl1",
    kind: "instalments",
    totalCents: 120000,
    paidCents: 0,
    status: "accepted",
    schedule: [
      { id: "s1", number: 1, amountCents: 40000, dueOn: "2026-06-30", isDeposit: false, status: "due" },
      { id: "s2", number: 2, amountCents: 40000, dueOn: "2026-07-30", isDeposit: false, status: "due" },
      { id: "s3", number: 3, amountCents: 40000, dueOn: "2026-08-30", isDeposit: false, status: "due" },
    ],
    ...over,
  });

  it("stops calling a bill overdue once a schedule replaces its due date", () => {
    // The due date was the terms before anybody renegotiated. Chasing a
    // client who is doing exactly what was agreed is the bug.
    const withPlan = inv({ dueOn: "2026-05-31", plan: plan() });
    expect(invoiceStatus(inv({ dueOn: "2026-05-31" }), TODAY)).toBe("overdue");
    expect(invoiceStatus(withPlan, TODAY)).toBe("on-plan");
  });

  it("calls it overdue again the moment they fall behind on the plan", () => {
    const behind = plan({
      schedule: [
        { id: "s1", number: 1, amountCents: 40000, dueOn: "2026-06-01", isDeposit: false, status: "due" },
      ],
    });
    expect(invoiceStatus(inv({ dueOn: "2026-05-31", plan: behind }), TODAY)).toBe("overdue");
  });

  it("counts the days from the payment they missed, not the original bill", () => {
    // Months late on the bill, two weeks late on the schedule that replaced
    // it. Two weeks is the true answer.
    const behind = plan({
      schedule: [
        { id: "s1", number: 1, amountCents: 40000, dueOn: "2026-06-01", isDeposit: false, status: "due" },
      ],
    });
    expect(daysOverdue(inv({ dueOn: "2026-01-01", plan: behind }), TODAY)).toBe(14);
  });

  it("reads the invoice as paid once the plan is paid off", () => {
    expect(invoiceStatus(inv({ paidOn: null, plan: plan({ paidCents: 120000 }) }), TODAY)).toBe("paid");
  });

  it("falls back to the invoice's own dates when the plan was cancelled", () => {
    const dead = plan({ status: "cancelled" });
    expect(invoiceStatus(inv({ dueOn: "2026-05-31", plan: dead }), TODAY)).toBe("overdue");
  });

  it("owes what is left on the plan rather than the face value", () => {
    const half = inv({ amount: 1200, dueOn: "2026-05-31", plan: plan({ paidCents: 40000 }) });
    expect(owedCents(half, TODAY)).toBe(80000);
    // Without a plan it is the whole bill.
    expect(owedCents(inv({ amount: 1200, dueOn: "2026-05-31" }), TODAY)).toBe(120000);
  });

  it("keeps the summary reconciling: what is owed plus what is in equals billed", () => {
    const s = summariseInvoices(
      [inv({ amount: 1200, dueOn: "2026-05-31", plan: plan({ paidCents: 40000 }) })],
      TODAY
    );
    expect(s.billedCents).toBe(120000);
    expect(s.owedCents).toBe(80000);
    expect(s.paidCents).toBe(40000);
    expect(s.onPlan).toBe(1);
    expect(s.overdue).toBe(0);
  });

  it("sorts one being paid to schedule below the ones needing a call", () => {
    const out = byUrgency(
      [
        inv({ id: "on-plan", dueOn: "2026-01-01", plan: plan() }),
        inv({ id: "late", dueOn: "2026-05-01" }),
        inv({ id: "paid", paidOn: "2026-06-01" }),
      ],
      TODAY
    );
    expect(out.map((o) => o.id)).toEqual(["late", "on-plan", "paid"]);
  });
});

describe("what the exporting system said", () => {
  it("takes the source's word for paid when there is nothing better", () => {
    // The payments export and the invoice export share no key, so no payment
    // can be joined to the bill it settled. The file's word is the evidence.
    expect(invoiceStatus(inv({ dueOn: "2026-05-01", sourceStatus: "paid" }), TODAY)).toBe("paid");
  });

  it("shows part paid as its own thing rather than as settled or overdue", () => {
    expect(invoiceStatus(inv({ dueOn: "2026-05-01", sourceStatus: "partial" }), TODAY)).toBe(
      "partly-paid"
    );
  });

  it("lets this app's own facts outrank the claim", () => {
    // A plan agreed here is a fact we hold; an export's status is hearsay
    // from before it. A bill on a live plan is not settled because a file
    // said so months ago.
    const onPlan = inv({
      dueOn: "2026-05-01",
      sourceStatus: "overdue",
      plan: {
        id: "pl", kind: "instalments", totalCents: 120000, paidCents: 0, status: "accepted",
        schedule: [
          { id: "s1", number: 1, amountCents: 120000, dueOn: "2026-09-30", isDeposit: false, status: "due" },
        ],
      },
    });
    expect(invoiceStatus(onPlan, TODAY)).toBe("on-plan");
    expect(invoiceStatus(inv({ paidOn: "2026-02-01", sourceStatus: "overdue" }), TODAY)).toBe("paid");
  });

  it("falls back to the dates when the source said nothing useful", () => {
    expect(invoiceStatus(inv({ dueOn: "2026-05-01", sourceStatus: "unknown" }), TODAY)).toBe("overdue");
    expect(invoiceStatus(inv({ dueOn: "2026-05-01", sourceStatus: null }), TODAY)).toBe("overdue");
  });

  it("stops chasing an invoice that was withdrawn", () => {
    // A voided bill is not owed. Leaving it in the overdue list is asking
    // somebody to ring a client about money nobody wants.
    expect(invoiceStatus(inv({ dueOn: "2026-01-01", sourceStatus: "void" }), TODAY)).toBe("paid");
  });
});

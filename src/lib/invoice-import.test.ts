import { describe, expect, it } from "vitest";
import {
  isBillable,
  normaliseInvoiceStatus,
  parseInvoiceCsv,
  previewInvoices,
  previewLine,
} from "./invoice-import";

/** The real export's header row, in its real order. */
const HEADERS =
  '"Invoice name","Invoice number","Recurring Flag","Line Item Name","Line Item Description",' +
  '"Line Item Amount","Line Item Quantity","Line Item Currency","Line Item Discount","Line Item Tax",' +
  '"Line Item ProductId","Line Item PriceId","Customer Id","Customer Name","Customer Email",' +
  '"Customer Phone No ","Issue Date","Due Date","Invoice Sub Total","Invoice Discount Amount",' +
  '"Invoice Tax Amount","Invoice Total","Status","Live mode"';

function row(o: {
  name?: string;
  number: string;
  itemName?: string;
  desc?: string;
  itemAmount?: string;
  custId?: string;
  custName?: string;
  email?: string;
  phone?: string;
  issued?: string;
  due?: string;
  sub?: string;
  discount?: string;
  total?: string;
  status?: string;
  live?: string;
}): string {
  return [
    o.name ?? "Landscape Proposal - Invoice",
    o.number,
    "No",
    o.itemName ?? "Scope",
    o.desc ?? "",
    o.itemAmount ?? "",
    "1",
    "USD",
    "0",
    "0",
    "pid",
    "prid",
    o.custId ?? "",
    o.custName ?? "",
    o.email ?? "",
    o.phone ?? "",
    o.issued ?? "",
    o.due ?? "",
    o.sub ?? "",
    o.discount ?? "",
    "0.00",
    o.total ?? "",
    o.status ?? "Paid",
    o.live ?? "Yes",
  ]
    .map((v) => `"${v.replace(/"/g, '""')}"`)
    .join(",");
}

const csv = (...rows: string[]) => [HEADERS, ...rows].join("\n");

describe("parseInvoiceCsv", () => {
  it("reads a whole invoice off one row", () => {
    const report = parseInvoiceCsv(
      csv(
        row({
          number: "INV-000066",
          custId: "HFr9daNZCjPwBRiOqsYX",
          custName: "Roger Johnson",
          email: "ghsthntr@comcast.net",
          issued: "Jun 13, 2026",
          due: "Sep 14, 2026",
          sub: "9,100.00",
          discount: "910.00",
          total: "8,190.00",
          status: "Partially Paid",
          desc: "<h1>Services Included</h1>",
        })
      )
    );

    expect(report.skipped).toEqual([]);
    const [draft] = report.drafts;
    expect(draft.externalId).toBe("INV-000066");
    expect(draft.totalCents).toBe(819000);
    expect(draft.subtotalCents).toBe(910000);
    expect(draft.discountCents).toBe(91000);
    expect(draft.issuedOn).toBe("2026-06-13");
    expect(draft.dueOn).toBe("2026-09-14");
    expect(draft.status).toBe("partial");
    expect(draft.customerExternalId).toBe("HFr9daNZCjPwBRiOqsYX");
    expect(draft.customerEmail).toBe("ghsthntr@comcast.net");
    expect(draft.scopeHtml).toBe("<h1>Services Included</h1>");
  });

  it("bills the invoice total, never the sum of the line items", () => {
    // The real INV-000002: three items at $2,100, $532 and $809 come to
    // $3,441, and the invoice is $3,391. Adding the lines up overcharges
    // every client who got a discount.
    const report = parseInvoiceCsv(
      csv(
        row({ number: "INV-000002", itemName: "Stump Grinding", itemAmount: "$2,100.00", total: "3,391.00", desc: "<p>stumps</p>" }),
        row({ number: "INV-000002", itemName: "Lawn Creation", itemAmount: "$532.00", desc: "<p>lawn</p>" }),
        row({ number: "INV-000002", itemName: "Landscaping Services", itemAmount: "$809.00", desc: "<p>mulch</p>" })
      )
    );

    expect(report.drafts).toHaveLength(1);
    expect(report.drafts[0].totalCents).toBe(339100);
  });

  it("keeps the scope from every line of a multi-line invoice", () => {
    // Keeping only the first would drop two thirds of what was sold.
    const report = parseInvoiceCsv(
      csv(
        row({ number: "INV-000002", total: "3,391.00", desc: "<p>stumps</p>" }),
        row({ number: "INV-000002", desc: "<p>lawn</p>" }),
        row({ number: "INV-000002", desc: "<p>mulch</p>" })
      )
    );
    expect(report.drafts[0].scopeHtml).toBe("<p>stumps</p>\n<p>lawn</p>\n<p>mulch</p>");
  });

  it("does not repeat a scope the invoice already carries", () => {
    const report = parseInvoiceCsv(
      csv(
        row({ number: "INV-1", total: "100.00", desc: "<p>same</p>" }),
        row({ number: "INV-1", desc: "<p>same</p>" })
      )
    );
    expect(report.drafts[0].scopeHtml).toBe("<p>same</p>");
  });

  it("keeps a genuine zero-dollar invoice rather than dropping it", () => {
    // The real file has one: INV-000068, $0.00, marked paid. A real record.
    const report = parseInvoiceCsv(csv(row({ number: "INV-000068", total: "0.00", sub: "0.00" })));
    expect(report.drafts).toHaveLength(1);
    expect(report.drafts[0].totalCents).toBe(0);
  });

  it("skips a row with no total and says which one", () => {
    const report = parseInvoiceCsv(csv(row({ number: "INV-9", total: "" })));
    expect(report.drafts).toHaveLength(0);
    expect(report.skipped[0].reason).toMatch(/INV-9/);
  });

  it("reads the phone column despite its trailing space in the header", () => {
    const report = parseInvoiceCsv(
      csv(row({ number: "INV-1", total: "100.00", phone: "+14104599365" }))
    );
    expect(report.drafts[0].customerPhone).toBe("+14104599365");
  });

  it("ignores a blank line rather than reporting it as a problem", () => {
    const report = parseInvoiceCsv(csv(row({ number: "INV-1", total: "100.00" }), ""));
    expect(report.drafts).toHaveLength(1);
    expect(report.skipped).toEqual([]);
  });
});

describe("normaliseInvoiceStatus", () => {
  it("does not read unpaid as paid", () => {
    // "unpaid" contains "paid". Reading it as settled stops a real bill
    // being chased.
    expect(normaliseInvoiceStatus("Unpaid")).toBe("open");
    expect(normaliseInvoiceStatus("Paid")).toBe("paid");
  });

  it("does not read partially paid as paid either", () => {
    // Some money arrived, which is not the bill being closed.
    expect(normaliseInvoiceStatus("Partially Paid")).toBe("partial");
  });

  it("reads the rest of the words an export uses", () => {
    expect(normaliseInvoiceStatus("Overdue")).toBe("overdue");
    expect(normaliseInvoiceStatus("Sent")).toBe("open");
    expect(normaliseInvoiceStatus("Void")).toBe("void");
    expect(normaliseInvoiceStatus("")).toBe("unknown");
  });
});

describe("previewInvoices", () => {
  const drafts = parseInvoiceCsv(
    csv(
      row({ number: "INV-1", total: "1,000.00", status: "Paid", custId: "a", desc: "<p>x</p>" }),
      row({ number: "INV-2", total: "500.00", status: "Overdue", custId: "b" }),
      row({ number: "INV-3", total: "250.00", status: "Paid", live: "No" }),
      row({ number: "INV-4", total: "999.00", status: "Void", custId: "c" })
    )
  ).drafts;

  it("counts only what was really billed", () => {
    const p = previewInvoices(drafts);
    // Test rows and voided invoices are neither owed nor billed.
    expect(p.count).toBe(2);
    expect(p.totalCents).toBe(150000);
    expect(p.paid).toBe(1);
    expect(p.outstanding).toBe(1);
    expect(p.testRows).toBe(1);
  });

  it("names the ones nobody can be found for", () => {
    const p = previewInvoices(
      parseInvoiceCsv(csv(row({ number: "INV-1", total: "100.00" }))).drafts
    );
    expect(p.noContact).toBe(1);
  });

  it("reports the test rows rather than quietly dropping them", () => {
    expect(previewLine(previewInvoices(drafts))).toMatch(/1 test rows, not counted/);
  });
});

describe("isBillable", () => {
  it("refuses a test row and a voided invoice", () => {
    const [live, test, voided] = parseInvoiceCsv(
      csv(
        row({ number: "INV-1", total: "100.00" }),
        row({ number: "INV-2", total: "100.00", live: "No" }),
        row({ number: "INV-3", total: "100.00", status: "Void" })
      )
    ).drafts;
    expect(isBillable(live)).toBe(true);
    expect(isBillable(test)).toBe(false);
    expect(isBillable(voided)).toBe(false);
  });
});

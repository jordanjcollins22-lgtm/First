import { describe, expect, it } from "vitest";

import {
  bookLine,
  effectiveType,
  hasPaid,
  miscalledClient,
  summariseBook,
  type ContactMoney,
} from "./client-status";

function contact(over: Partial<ContactMoney> = {}): ContactMoney {
  return { paidCents: 0, contactType: "lead", ...over };
}

describe("effectiveType", () => {
  it("makes somebody a client the moment they pay", () => {
    expect(effectiveType(contact({ paidCents: 51750 }))).toBe("client");
  });

  it("leaves somebody who has never paid as a lead, however warm", () => {
    // However many quotes they have had, however long they have been on the
    // books. The word has to mean something or every count built on it is
    // measuring something else.
    expect(effectiveType(contact())).toBe("lead");
  });

  it("overrules a row an old import called a client", () => {
    expect(effectiveType(contact({ contactType: "client", paidCents: 0 }))).toBe("lead");
  });

  it("leaves a supplier a supplier, whichever way money went", () => {
    // A standing relationship money does not define.
    expect(effectiveType(contact({ contactType: "supplier", paidCents: 100000 }))).toBe("supplier");
    expect(effectiveType(contact({ contactType: "subcontractor" }))).toBe("subcontractor");
  });

  it("leaves a flyer advertiser a business, even though they paid", () => {
    expect(effectiveType(contact({ contactType: "business", paidCents: 30000 }))).toBe("business");
  });

  it("sorts an unsorted contact by the money too", () => {
    expect(effectiveType(contact({ contactType: null, paidCents: 100 }))).toBe("client");
    expect(effectiveType(contact({ contactType: null }))).toBe("lead");
  });
});

describe("hasPaid", () => {
  it("is any money at all", () => {
    expect(hasPaid(contact({ paidCents: 1 }))).toBe(true);
    expect(hasPaid(contact({ paidCents: 0 }))).toBe(false);
  });
});

describe("miscalledClient", () => {
  it("flags a row the book calls a client that has never paid", () => {
    expect(miscalledClient(contact({ contactType: "client" }))).toBe(true);
  });

  it("does not flag one that has", () => {
    expect(miscalledClient(contact({ contactType: "client", paidCents: 5 }))).toBe(false);
  });

  it("does not flag a lead, which is not claiming to be anything", () => {
    expect(miscalledClient(contact())).toBe(false);
  });
});

describe("summariseBook", () => {
  it("counts the book by what the money says", () => {
    const summary = summariseBook([
      contact({ paidCents: 100 }),
      contact({ contactType: "client", paidCents: 0 }),
      contact(),
      contact({ contactType: "supplier" }),
    ]);
    expect(summary).toEqual({ clients: 1, leads: 2, miscalled: 1, billedUnpaid: 0 });
  });

  it("is empty for an empty book", () => {
    expect(summariseBook([])).toEqual({ clients: 0, leads: 0, miscalled: 0, billedUnpaid: 0 });
  });
});

describe("bookLine", () => {
  it("says what the words mean, because this one changed", () => {
    const line = bookLine(summariseBook([contact({ paidCents: 1 }), contact()]));
    expect(line).toBe("1 client, 1 lead. A client is somebody we have billed or been paid by.");
  });
});


describe("somebody we have billed", () => {
  const billed = { paidCents: 0, invoiceCount: 1, contactType: "lead" };

  it("is a client even with no payment recorded against them", () => {
    // Twenty people here. The payments export and the invoice export share
    // no key, so a bill and the money that settled it cannot be joined --
    // and somebody we sent a bill to is not a prospect.
    expect(effectiveType(billed)).toBe("client");
  });

  it("is a client while the bill is still unpaid", () => {
    // Being owed money is a relationship, not a lead.
    expect(effectiveType({ paidCents: 0, invoiceCount: 3, contactType: "" })).toBe("client");
  });

  it("stays a lead with no bill and no money", () => {
    expect(effectiveType({ paidCents: 0, invoiceCount: 0, contactType: "client" })).toBe("lead");
  });

  it("does not turn a supplier into a client", () => {
    // A supplier we billed for something is still a supplier. Money and
    // bills decide nothing about a standing relationship.
    expect(effectiveType({ paidCents: 500, invoiceCount: 2, contactType: "supplier" })).toBe(
      "supplier"
    );
  });

  it("treats an absent count as nothing known rather than nothing billed", () => {
    // Callers that ask before invoices are in the picture must not have
    // their contacts silently demoted.
    expect(effectiveType({ paidCents: 1000, contactType: "lead" })).toBe("client");
    expect(effectiveType({ paidCents: 0, contactType: "client" })).toBe("lead");
  });

  it("is no longer miscalled once a bill exists", () => {
    expect(miscalledClient({ paidCents: 0, invoiceCount: 1, contactType: "client" })).toBe(false);
    expect(miscalledClient({ paidCents: 0, invoiceCount: 0, contactType: "client" })).toBe(true);
  });

  it("counts the billed-but-unpaid separately, because it is a list to work", () => {
    const summary = summariseBook([
      { paidCents: 0, invoiceCount: 1, contactType: "lead" },
      { paidCents: 5000, invoiceCount: 1, contactType: "lead" },
      { paidCents: 5000, invoiceCount: 0, contactType: "lead" },
      { paidCents: 0, invoiceCount: 0, contactType: "lead" },
    ]);
    expect(summary.clients).toBe(3);
    expect(summary.leads).toBe(1);
    expect(summary.billedUnpaid).toBe(1);
  });

  it("says so on the line above the book", () => {
    const line = bookLine(summariseBook([{ paidCents: 0, invoiceCount: 1, contactType: "lead" }]));
    expect(line).toMatch(/1 billed with no payment recorded/);
  });
});

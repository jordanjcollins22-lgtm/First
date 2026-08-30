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
    expect(summary).toEqual({ clients: 1, leads: 2, miscalled: 1 });
  });

  it("is empty for an empty book", () => {
    expect(summariseBook([])).toEqual({ clients: 0, leads: 0, miscalled: 0 });
  });
});

describe("bookLine", () => {
  it("says what the words mean, because this one changed", () => {
    const line = bookLine(summariseBook([contact({ paidCents: 1 }), contact()]));
    expect(line).toBe("1 client, 1 lead. A client is somebody who has paid us.");
  });
});

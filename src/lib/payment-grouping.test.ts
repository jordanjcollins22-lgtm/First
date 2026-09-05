import { describe, expect, it } from "vitest";

import {
  contactsWithNoProject,
  groupPayments,
  groupsNeedingProject,
  suggestedProjectName,
  summarise,
  type PaymentRow,
} from "./payment-grouping";

function pay(over: Partial<PaymentRow> & { id: string; receivedAt: string }): PaymentRow {
  return {
    customerId: "c1",
    jobId: null,
    amountCents: 10_000,
    stripeInvoiceId: null,
    ...over,
  };
}

describe("groupPayments", () => {
  it("returns nothing for nothing", () => {
    expect(groupPayments([])).toEqual([]);
  });

  it("puts payments on the same invoice into one group", () => {
    const groups = groupPayments([
      pay({ id: "a", receivedAt: "2026-01-10T00:00:00Z", stripeInvoiceId: "in_1" }),
      pay({ id: "b", receivedAt: "2026-06-10T00:00:00Z", stripeInvoiceId: "in_1" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].paymentIds).toEqual(["a", "b"]);
    expect(groups[0].reason).toBe("invoice");
  });

  it("keeps one invoice together even when the payments are months apart", () => {
    // Invoice 000052 in the live account is five charges across a spring.
    // A time window would split it; the invoice id must win.
    const rows = ["2026-04-11", "2026-05-11", "2026-06-11", "2026-07-11", "2026-08-11"].map((d, i) =>
      pay({ id: `p${i}`, receivedAt: `${d}T00:00:00Z`, stripeInvoiceId: "in_52", amountCents: 25_000 })
    );
    const groups = groupPayments(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].paymentIds).toHaveLength(5);
    expect(groups[0].totalCents).toBe(125_000);
  });

  it("groups a deposit and a balance from the same contact", () => {
    const groups = groupPayments([
      pay({ id: "deposit", receivedAt: "2026-03-01T00:00:00Z", amountCents: 500 }),
      pay({ id: "balance", receivedAt: "2026-03-20T00:00:00Z", amountCents: 120_000 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("window");
    expect(groups[0].totalCents).toBe(120_500);
  });

  it("starts a new group once the window is past", () => {
    const groups = groupPayments([
      pay({ id: "spring", receivedAt: "2026-03-01T00:00:00Z" }),
      pay({ id: "autumn", receivedAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("measures the window from the first payment, so a group cannot creep", () => {
    // Monthly payments, each within 60 days of the one before. Chained, these
    // would all collapse into a single group and keep growing forever.
    const rows = ["2026-01-01", "2026-02-15", "2026-04-01", "2026-05-15", "2026-07-01"].map((d, i) =>
      pay({ id: `m${i}`, receivedAt: `${d}T00:00:00Z` })
    );
    const groups = groupPayments(rows);
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      const span = Date.parse(g.lastAt) - Date.parse(g.firstAt);
      expect(span).toBeLessThanOrEqual(60 * 24 * 60 * 60 * 1000);
    }
  });

  it("honours the window option", () => {
    const rows = [
      pay({ id: "a", receivedAt: "2026-03-01T00:00:00Z" }),
      pay({ id: "b", receivedAt: "2026-03-20T00:00:00Z" }),
    ];
    expect(groupPayments(rows, { windowDays: 60 })).toHaveLength(1);
    expect(groupPayments(rows, { windowDays: 7 })).toHaveLength(2);
  });

  it("keeps two invoices apart even when they are days apart", () => {
    // Time is a guess; an invoice is the customer saying which job this was.
    // Two invoices a fortnight apart are two jobs, not one.
    const groups = groupPayments([
      pay({ id: "a", receivedAt: "2026-03-01T00:00:00Z", stripeInvoiceId: "in_1" }),
      pay({ id: "b", receivedAt: "2026-03-15T00:00:00Z", stripeInvoiceId: "in_2" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("lets an uninvoiced deposit join the invoiced work that follows it", () => {
    const groups = groupPayments([
      pay({ id: "deposit", receivedAt: "2026-03-01T00:00:00Z", amountCents: 500 }),
      pay({ id: "invoiced", receivedAt: "2026-03-20T00:00:00Z", stripeInvoiceId: "in_1" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].paymentIds).toEqual(["deposit", "invoiced"]);
    expect(groups[0].reason).toBe("invoice");
  });

  it("never groups two different contacts together", () => {
    const groups = groupPayments([
      pay({ id: "a", customerId: "c1", receivedAt: "2026-03-01T00:00:00Z" }),
      pay({ id: "b", customerId: "c2", receivedAt: "2026-03-02T00:00:00Z" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("groups by project when one is set, beating the invoice", () => {
    const groups = groupPayments([
      pay({ id: "a", receivedAt: "2026-03-01T00:00:00Z", jobId: "j1", stripeInvoiceId: "in_1" }),
      pay({ id: "b", receivedAt: "2027-03-01T00:00:00Z", jobId: "j1", stripeInvoiceId: "in_2" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].reason).toBe("job");
    expect(groups[0].jobId).toBe("j1");
  });

  it("stops calling a group a guess once a project turns up in it", () => {
    // Two payments on one invoice, and somebody has since attached the second
    // to a project. The group is now told, not guessed.
    const groups = groupPayments([
      pay({ id: "a", receivedAt: "2026-03-01T00:00:00Z", stripeInvoiceId: "in_1" }),
      pay({ id: "b", receivedAt: "2026-03-05T00:00:00Z", stripeInvoiceId: "in_1", jobId: "j9" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].jobId).toBe("j9");
    expect(groups[0].reason).toBe("job");
  });

  it("leaves money with no contact standing on its own", () => {
    const groups = groupPayments([
      pay({ id: "a", customerId: null, receivedAt: "2026-03-01T00:00:00Z" }),
      pay({ id: "b", customerId: null, receivedAt: "2026-03-02T00:00:00Z" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.reason === "unmatched")).toBe(true);
  });

  it("orders payments within a group by when the money arrived", () => {
    const groups = groupPayments([
      pay({ id: "late", receivedAt: "2026-03-20T00:00:00Z", stripeInvoiceId: "in_1" }),
      pay({ id: "early", receivedAt: "2026-03-01T00:00:00Z", stripeInvoiceId: "in_1" }),
    ]);
    expect(groups[0].paymentIds).toEqual(["early", "late"]);
    expect(groups[0].firstAt).toBe("2026-03-01T00:00:00Z");
    expect(groups[0].lastAt).toBe("2026-03-20T00:00:00Z");
  });

  it("does not lose or invent a penny", () => {
    const rows: PaymentRow[] = [];
    for (let i = 0; i < 40; i += 1) {
      rows.push(
        pay({
          id: `p${i}`,
          customerId: `c${i % 5}`,
          receivedAt: new Date(Date.UTC(2026, i % 12, (i % 27) + 1)).toISOString(),
          amountCents: 100 + i * 37,
          stripeInvoiceId: i % 3 === 0 ? `in_${i % 7}` : null,
        })
      );
    }
    const groups = groupPayments(rows);
    const total = rows.reduce((sum, r) => sum + r.amountCents, 0);
    expect(summarise(groups).totalCents).toBe(total);
    expect(groups.flatMap((g) => g.paymentIds).sort()).toEqual(rows.map((r) => r.id).sort());
  });

  it("is stable when two payments land in the same second", () => {
    const rows = [
      pay({ id: "b", receivedAt: "2026-03-01T00:00:00Z", stripeInvoiceId: "in_2" }),
      pay({ id: "a", receivedAt: "2026-03-01T00:00:00Z", stripeInvoiceId: "in_1" }),
    ];
    const once = groupPayments(rows).map((g) => g.key);
    const twice = groupPayments([...rows].reverse()).map((g) => g.key);
    expect(once).toEqual(twice);
  });
});

describe("groupsNeedingProject", () => {
  it("is every group without a project", () => {
    const groups = groupPayments([
      pay({ id: "a", receivedAt: "2026-03-01T00:00:00Z", jobId: "j1" }),
      pay({ id: "b", customerId: "c2", receivedAt: "2026-03-02T00:00:00Z" }),
    ]);
    const needing = groupsNeedingProject(groups);
    expect(needing).toHaveLength(1);
    expect(needing[0].paymentIds).toEqual(["b"]);
  });
});

describe("contactsWithNoProject", () => {
  it("names a contact who paid and has nothing documented", () => {
    const groups = groupPayments([pay({ id: "a", customerId: "c9", receivedAt: "2026-03-01T00:00:00Z" })]);
    expect(contactsWithNoProject(groups)).toEqual(["c9"]);
  });

  it("leaves out a contact who has a project, even with a stray payment", () => {
    const groups = groupPayments([
      pay({ id: "a", customerId: "c1", receivedAt: "2026-01-01T00:00:00Z", jobId: "j1" }),
      pay({ id: "b", customerId: "c1", receivedAt: "2026-09-01T00:00:00Z" }),
    ]);
    expect(contactsWithNoProject(groups)).toEqual([]);
  });

  it("ignores money with no contact on it", () => {
    const groups = groupPayments([pay({ id: "a", customerId: null, receivedAt: "2026-03-01T00:00:00Z" })]);
    expect(contactsWithNoProject(groups)).toEqual([]);
  });
});

describe("summarise", () => {
  it("splits linked from unlinked and adds back up", () => {
    const groups = groupPayments([
      pay({ id: "a", receivedAt: "2026-03-01T00:00:00Z", jobId: "j1", amountCents: 30_000 }),
      pay({ id: "b", customerId: "c2", receivedAt: "2026-03-02T00:00:00Z", amountCents: 20_000 }),
      pay({ id: "c", customerId: null, receivedAt: "2026-03-03T00:00:00Z", amountCents: 5_000 }),
    ]);
    const s = summarise(groups);
    expect(s.totalCents).toBe(55_000);
    expect(s.linkedCents).toBe(30_000);
    expect(s.unlinkedCents).toBe(25_000);
    expect(s.unmatchedCents).toBe(5_000);
    expect(s.linked + s.needingProject).toBe(s.groups);
  });
});

describe("suggestedProjectName", () => {
  it("names the month the money first arrived", () => {
    const [group] = groupPayments([pay({ id: "a", receivedAt: "2026-03-04T00:00:00Z" })]);
    expect(suggestedProjectName(group)).toBe("Work in March 2026");
  });
});

describe("money with no contact", () => {
  const at = (day: number) => `2026-0${day <= 9 ? day : 9}-01T12:00:00.000Z`;

  it("joins two unmatched payments that arrived from the same email", () => {
    // One person paid twice. Three cards saying the same thing means three
    // links to make; one card means one.
    const groups = groupPayments([
      { id: "a", customerId: null, jobId: null, amountCents: 100, receivedAt: at(1), stripeInvoiceId: null, payerEmail: "jane@example.com" },
      { id: "b", customerId: null, jobId: null, amountCents: 200, receivedAt: at(2), stripeInvoiceId: null, payerEmail: "Jane@Example.com " },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalCents).toBe(300);
  });

  it("keeps different payers apart", () => {
    const groups = groupPayments([
      { id: "a", customerId: null, jobId: null, amountCents: 100, receivedAt: at(1), stripeInvoiceId: null, payerEmail: "jane@example.com" },
      { id: "b", customerId: null, jobId: null, amountCents: 200, receivedAt: at(1), stripeInvoiceId: null, payerEmail: "dave@example.com" },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("does not join payments that only share a missing email", () => {
    // Null is not a value two payments can have in common.
    const groups = groupPayments([
      { id: "a", customerId: null, jobId: null, amountCents: 100, receivedAt: at(1), stripeInvoiceId: null, payerEmail: null },
      { id: "b", customerId: null, jobId: null, amountCents: 200, receivedAt: at(1), stripeInvoiceId: null, payerEmail: null },
    ]);
    expect(groups).toHaveLength(2);
  });

  it("leaves a payment that already has a contact grouped by the contact", () => {
    // A payer email is what the card was registered to, not who the work was
    // for. Once somebody has said whose money it is, that wins.
    const groups = groupPayments([
      { id: "a", customerId: "c1", jobId: null, amountCents: 100, receivedAt: at(1), stripeInvoiceId: null, payerEmail: "shared@example.com" },
      { id: "b", customerId: "c2", jobId: null, amountCents: 200, receivedAt: at(1), stripeInvoiceId: null, payerEmail: "shared@example.com" },
    ]);
    expect(groups).toHaveLength(2);
  });
});

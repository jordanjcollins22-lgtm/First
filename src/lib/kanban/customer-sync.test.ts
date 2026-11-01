import { describe, expect, it } from "vitest";

import { cardForCustomer, leadFacts, planCustomerSync, type NewCustomer } from "./customer-sync";

const c = (id: string, over: Partial<NewCustomer> = {}): NewCustomer => ({
  id,
  name: `Lead ${id}`,
  phone: null,
  email: null,
  source: null,
  address: null,
  created_at: "2026-10-20T00:00:00Z",
  ...over,
});

describe("planCustomerSync", () => {
  it("adds a card for each new lead without one, oldest first", () => {
    const cards = planCustomerSync(
      [c("b", { created_at: "2026-10-25T00:00:00Z" }), c("a", { created_at: "2026-10-21T00:00:00Z" }), c("seen")],
      new Set(["seen"])
    );
    expect(cards.map((x) => x.customer_id)).toEqual(["a", "b"]);
  });
});

describe("cardForCustomer", () => {
  it("lays out the lead like the mockup", () => {
    expect(
      cardForCustomer(
        c("d", {
          name: "Dave Peterson",
          phone: "(410) 459-9365",
          email: "dave@example.com",
          address: "1114 Wheatland Court, Forest Hill",
          source: "Social media post",
        })
      )
    ).toEqual({
      customer_id: "d",
      title: "Dave Peterson",
      asked_by: null,
      details:
        "Phone: (410) 459-9365\nEmail: dave@example.com\nAddress: 1114 Wheatland Court, Forest Hill\nSource: Social media post",
      backlog_group: "External",
    });
  });

  it("says when the source is unknown", () => {
    expect(cardForCustomer(c("x")).details).toBe("Source: Unknown");
  });
});

describe("leadFacts", () => {
  it("is no and no with no jobs", () => {
    expect(leadFacts([])).toEqual({ bookedEval: false, bookedJob: false });
  });

  it("counts a booked evaluation, and a sold job that wasn't declined", () => {
    expect(leadFacts([{ status: "estimating", evaluation_date: "2026-11-03", declined_at: null }])).toEqual({
      bookedEval: true,
      bookedJob: false,
    });
    expect(leadFacts([{ status: "approved", evaluation_date: null, declined_at: null }])).toEqual({
      bookedEval: true,
      bookedJob: true,
    });
    expect(leadFacts([{ status: "approved", evaluation_date: "2026-10-01", declined_at: "2026-10-05" }])).toEqual({
      bookedEval: true,
      bookedJob: false,
    });
  });
});

import { describe, expect, it } from "vitest";

import { cardForProspect, planLeadSync, type Prospect } from "./lead-sync";

const p = (id: string, over: Partial<Prospect> = {}): Prospect => ({
  id,
  owner_name: null,
  address: `${id} Main St`,
  city: null,
  phone: null,
  email: null,
  status: "new",
  do_not_contact: false,
  score: null,
  estimated_ticket: null,
  ...over,
});

describe("planLeadSync", () => {
  it("adds new and queued leads, best score first, and skips the rest", () => {
    const { toAdd } = planLeadSync(
      [
        p("low", { score: 10 }),
        p("high", { score: 90, status: "queued" }),
        p("none"),
        p("called", { status: "contacted", score: 99 }),
        p("stop", { do_not_contact: true, score: 99 }),
      ],
      []
    );
    expect(toAdd.map((c) => c.prospect_id)).toEqual(["high", "low", "none"]);
  });

  it("never adds a second card for a lead", () => {
    expect(planLeadSync([p("a")], [{ id: "c", prospect_id: "a", stage: "breakdown" }]).toAdd).toEqual([]);
  });

  it("takes reached leads off the Backlog but leaves cards being worked", () => {
    const { toRemove } = planLeadSync(
      [p("called", { status: "contacted" }), p("open")],
      [
        { id: "c1", prospect_id: "called", stage: "backlog" },
        { id: "c2", prospect_id: "gone", stage: "answer" },
        { id: "c3", prospect_id: "open", stage: "backlog" },
      ]
    );
    expect(toRemove).toEqual(["c1"]);
  });
});

describe("cardForProspect", () => {
  it("names the owner, with the address and how to reach them", () => {
    expect(
      cardForProspect(p("a", { owner_name: "Pat Lee", city: "Towson", phone: "410-555-0101", estimated_ticket: 2400 }))
    ).toEqual({
      prospect_id: "a",
      title: "Reach out: Pat Lee",
      asked_by: null,
      details: "a Main St, Towson\n410-555-0101\nWorth about $2,400",
      backlog_group: "External",
    });
  });

  it("falls back to the address when there is no owner name", () => {
    expect(cardForProspect(p("b")).title).toBe("Reach out: b Main St");
  });
});

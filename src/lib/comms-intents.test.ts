import { describe, expect, it } from "vitest";

import { keywordIntent, nextMondays, NO_FACTS, parseHint, resolveIntent, type PersonFacts } from "@/lib/comms-intents";
import { buildSections, factsFrom, EMPTY_RAW, type PersonRaw } from "@/lib/comms-person";

const proposal = {
  id: "p1",
  jobId: "j1",
  token: "tok",
  status: "sent",
  totalCents: 240000,
  paidAt: null,
  paymentPath: null,
  zones: [
    { name: "Front beds", service: "Mulch", scope: "3 yards black mulch", priceCents: 86000 },
    { name: "Back slope", service: "Planting", scope: "12 shrubs", priceCents: 154000 },
  ],
};

const facts = (over: Partial<PersonFacts> = {}): PersonFacts => ({ ...NO_FACTS, name: "Dana Whitfield", jobId: "j1", proposal, ...over });

describe("keyword intent", () => {
  it.each([
    [["Can you adjust my proposal? Drop the back slope."], "proposal_change"],
    [["Just accepted the proposal and paid the deposit!"], "proposal_accepted"],
    [["How much for mulch and edging?"], "quote_request"],
    [["Can we reschedule to next week?"], "schedule"],
    [["The crew left a mess and a dead shrub"], "issue"],
    [["Got the invoice, is there a balance?"], "payment"],
    [["Great job, thanks!"], "thanks"],
    [["We offer SEO services to rank your business"], "not_client"],
    [["Do you guys work in Bel Air?"], "question"],
  ])("%s is %s", (texts, intent) => {
    expect(keywordIntent(texts)).toBe(intent);
  });
});

describe("reading Claude's breakdown", () => {
  it("keeps only areas and days that exist", () => {
    const raw = JSON.stringify({ intent: "proposal_change", summary: "Lower front beds", zone_name: "Nowhere", change: "price", new_price_dollars: 700, slot_date: "2030-01-01" });
    const hint = parseHint(raw, ["Front beds"], ["2026-11-17"]);
    expect(hint).toMatchObject({ intent: "proposal_change", zoneName: null, newPriceCents: 70000, slotDate: null });
    expect(parseHint("not json", [], [])).toBeNull();
    expect(parseHint(JSON.stringify({ intent: "made_up" }), [], [])).toBeNull();
  });
});

describe("resolvers", () => {
  const base = { said: [] as string[], today: "2026-11-09" };

  it("proposal change with a price: highlights the line and recommends the new price", () => {
    const b = resolveIntent({ ...base, facts: facts(), hint: { intent: "proposal_change", summary: "", zoneName: "Front beds", change: "price", newPriceCents: 72000 } });
    expect(b.question).toBeNull();
    expect(b.resources[0].href).toBe("/proposal/tok");
    expect(b.resources[0].highlight).toContain("Front beds");
    expect(b.action).toMatchObject({ kind: "proposal_price", zoneName: "Front beds", fromCents: 86000, toCents: 72000, newTotalCents: 226000 });
    expect(b.message).toContain("$2,260");
  });

  it("proposal change with no price asks Jordan, with tap answers", () => {
    const b = resolveIntent({ ...base, facts: facts(), said: ["can you do the back slope cheaper"], hint: { intent: "proposal_change", summary: "" } });
    expect(b.question?.text).toContain("Back slope");
    expect(b.question?.options).toContain("Remove the area");
    const answered = resolveIntent({ ...base, facts: facts(), said: ["can you do the back slope cheaper"], hint: { intent: "proposal_change", summary: "" }, answer: "$1,300" });
    expect(answered.question).toBeNull();
    expect(answered.action).toMatchObject({ kind: "proposal_price", toCents: 130000 });
  });

  it("removing an area takes its price off the total", () => {
    const b = resolveIntent({ ...base, facts: facts(), hint: { intent: "proposal_change", summary: "", zoneName: "Back slope", change: "remove" } });
    expect(b.action).toMatchObject({ kind: "proposal_remove", proposalId: "p1", newTotalCents: 86000 });
  });

  it("accepted and paid: materials, open days, payment, and a booking", () => {
    const b = resolveIntent({
      ...base,
      facts: facts({
        proposal: { ...proposal, status: "accepted", paidAt: "2026-11-08T12:00:00Z" },
        materials: [{ name: "Black mulch", quantity: "3 yd", toOrder: "3 yd" }, { name: "Edging", quantity: "40 ft", toOrder: null }],
        slots: [{ date: "2026-11-17", crewNames: ["Luis", "Sam"], crewProfileIds: ["u1", "u2"], because: ["Nearby job that day"] }],
        paidCents: 120000,
        balanceCents: 120000,
      }),
      hint: { intent: "proposal_accepted", summary: "" },
    });
    expect(b.resources.map((r) => r.label)).toEqual(expect.arrayContaining([expect.stringContaining("Materials · 1 to order"), expect.stringContaining("Open days · 1")]));
    expect(b.action).toMatchObject({ kind: "book", date: "2026-11-17", crewProfileIds: ["u1", "u2"] });
    expect(b.message).toContain("Tue, Nov 17");
  });

  it("accepted with no open day asks which week", () => {
    const b = resolveIntent({ ...base, facts: facts({ proposal: { ...proposal, status: "accepted" } }), hint: { intent: "proposal_accepted", summary: "" } });
    expect(b.question?.options[0]).toBe("Week of 2026-11-16");
    expect(nextMondays("2026-11-16", 1)).toEqual(["2026-11-23"]);
  });

  it("a complaint waits on Jordan; spam gets no reply", () => {
    expect(resolveIntent({ ...base, facts: facts(), hint: { intent: "issue", summary: "" } }).question).not.toBeNull();
    expect(resolveIntent({ ...base, facts: facts(), hint: { intent: "not_client", summary: "" } }).action.kind).toBe("no_reply");
  });
});

describe("the person's record", () => {
  const raw: PersonRaw = {
    ...EMPTY_RAW,
    customer: { id: "c1", name: "Dana", phone: "4105550142", email: "dana@example.com", notes: "Gate code 1234", tags: ["repeat"], source: "website", contactType: "client", doNotContact: false, createdAt: "2025-04-01" },
    properties: [{ id: "pr1", address: "1 Elm St", sqft: 2100, acreage: 0.4, notes: null }],
    jobs: [{ id: "j1", name: "Spring mulch", jobNumber: "1182", status: "completed", createdAt: "2026-03-01", evaluationDate: "2026-03-05", projectStartDate: "2026-04-20", projectEndDate: null, completedAt: "2026-04-21", heardAbout: "google", clientNotes: null }],
    invoices: [{ id: "i1", jobId: "j1", status: "open", amountCents: 50000, sentAt: "2026-04-22", paidAt: null, hostedUrl: null }],
    payments: [{ id: "pay1", jobId: "j1", amountCents: 36000, method: "card", receivedAt: "2026-04-22" }],
  };

  it("has every section, each with a count and a link", () => {
    const person = { name: "Dana", phones: [], emails: [], handles: [], jobIds: ["j1"], messages: [{ id: "m", channel: "sms" as const, direction: "in" as const, text: "hi", at: "2026-11-08T10:00:00Z" }] };
    const sections = buildSections(raw, person, "2026-11-09");
    expect(sections.map((s) => s.id)).toEqual(["contact", "property", "estimates", "proposals", "invoices", "history", "calendar", "jobs", "photos", "notes", "source", "last", "open"]);
    expect(sections.find((s) => s.id === "invoices")?.summary).toBe("Paid $360 · Balance $500");
    expect(sections.find((s) => s.id === "calendar")?.count).toBe(2);
    expect(sections.find((s) => s.id === "contact")?.href).toBe("/clients/c1");
  });

  it("gives Breakdown the newest job and the balance", () => {
    const f = factsFrom(raw, "Dana", "2026-11-09");
    expect(f.jobId).toBe("j1");
    expect(f.balanceCents).toBe(50000);
  });
});

import { describe, expect, it } from "vitest";

import {
  buildContactTree,
  byOpportunity,
  contactSummary,
  neverSold,
  nothingToWorkWith,
  type TreeInput,
} from "./contact-tree";

function tree(over: Partial<TreeInput> = {}) {
  return buildContactTree({
    contacts: [
      { id: "c1", name: "Jo Miller", email: null, phone: null, contactType: "client", doNotContact: false },
    ],
    properties: [{ id: "p1", customerId: "c1", address: "4 Elm Road", acreage: 0.5 }],
    jobs: [
      {
        id: "j1", propertyId: "p1", name: "Front bed", status: "completed", jobNumber: 1,
        evaluationDate: "2026-03-01", projectStartDate: "2026-03-10",
        projectEndDate: "2026-03-12", createdAt: "2026-02-20",
      },
    ],
    proposals: [{ jobId: "j1", status: "accepted", totalCost: 5200 }],
    ...over,
  });
}

describe("the shape the business actually has", () => {
  it("is a person, their properties, and the work on each", () => {
    const [jo] = tree();
    expect(jo.name).toBe("Jo Miller");
    expect(jo.properties).toHaveLength(1);
    expect(jo.properties[0].address).toBe("4 Elm Road");
    expect(jo.properties[0].projects[0].name).toBe("Front bed");
  });

  it("keeps one person as one row however many properties they have", () => {
    // A person with three properties used to be three rows, each scored on
    // its own, so nobody could see the three were one customer.
    const [jo] = tree({
      properties: [
        { id: "p1", customerId: "c1", address: "4 Elm Road", acreage: 0.5 },
        { id: "p2", customerId: "c1", address: "9 Oak Lane", acreage: 1.2 },
        { id: "p3", customerId: "c1", address: "1 High Street", acreage: null },
      ],
    });
    expect(jo.propertyCount).toBe(3);
  });

  it("counts every project across every property", () => {
    const [jo] = tree({
      properties: [
        { id: "p1", customerId: "c1", address: "A", acreage: null },
        { id: "p2", customerId: "c1", address: "B", acreage: null },
      ],
      jobs: [
        { id: "j1", propertyId: "p1", name: "One", status: "completed", jobNumber: 1, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-01-01" },
        { id: "j2", propertyId: "p2", name: "Two", status: "in_progress", jobNumber: 2, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-02-01" },
        { id: "j3", propertyId: "p2", name: "Three", status: "quoted", jobNumber: 3, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-03-01" },
      ],
      proposals: [],
    });
    expect(jo.projectCount).toBe(3);
  });

  it("keeps a contact with no property at all", () => {
    // Somebody who rang once is still a person on the books.
    const [jo] = tree({ properties: [], jobs: [], proposals: [] });
    expect(jo.propertyCount).toBe(0);
    expect(nothingToWorkWith(jo)).toBe(true);
  });

  it("does not hand one person another person's property", () => {
    const contacts = [
      { id: "c1", name: "Jo", email: null, phone: null, contactType: "client", doNotContact: false },
      { id: "c2", name: "Sam", email: null, phone: null, contactType: "client", doNotContact: false },
    ];
    const [jo, sam] = buildContactTree({
      contacts,
      properties: [
        { id: "p1", customerId: "c1", address: "Jo's", acreage: null },
        { id: "p2", customerId: "c2", address: "Sam's", acreage: null },
      ],
      jobs: [],
      proposals: [],
    });
    expect(jo.properties[0].address).toBe("Jo's");
    expect(sam.properties[0].address).toBe("Sam's");
  });
});

describe("live work", () => {
  it("counts anything not finished or cancelled", () => {
    const [jo] = tree({
      jobs: [
        { id: "j1", propertyId: "p1", name: "Done", status: "completed", jobNumber: 1, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-01-01" },
        { id: "j2", propertyId: "p1", name: "Off", status: "cancelled", jobNumber: 2, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-01-01" },
        { id: "j3", propertyId: "p1", name: "Going", status: "in_progress", jobNumber: 3, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-01-01" },
        { id: "j4", propertyId: "p1", name: "Quoted", status: "quoted", jobNumber: 4, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-01-01" },
      ],
      proposals: [],
    });
    expect(jo.liveProjects).toBe(2);
  });
});

describe("lifetime value", () => {
  it("counts work that was actually won", () => {
    expect(tree()[0].lifetimeValue).toBe(5200);
  });

  it("ignores a quote nobody accepted", () => {
    // Counting those is how a list of best customers fills with people who
    // never bought anything.
    const [jo] = tree({ proposals: [{ jobId: "j1", status: "sent", totalCost: 9000 }] });
    expect(jo.lifetimeValue).toBe(0);
    expect(neverSold(jo)).toBe(true);
  });

  it("adds up across properties", () => {
    const [jo] = tree({
      properties: [
        { id: "p1", customerId: "c1", address: "A", acreage: null },
        { id: "p2", customerId: "c1", address: "B", acreage: null },
      ],
      jobs: [
        { id: "j1", propertyId: "p1", name: "One", status: "completed", jobNumber: 1, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-01-01" },
        { id: "j2", propertyId: "p2", name: "Two", status: "completed", jobNumber: 2, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-02-01" },
      ],
      proposals: [
        { jobId: "j1", status: "accepted", totalCost: 5000 },
        { jobId: "j2", status: "accepted", totalCost: 3000 },
      ],
    });
    expect(jo.lifetimeValue).toBe(8000);
  });
});

describe("last activity", () => {
  it("is the most recent date anywhere on their record", () => {
    expect(tree()[0].lastActivityAt).toBe("2026-03-12");
  });

  it("falls back through the dates a job might have", () => {
    const [jo] = tree({
      jobs: [{ id: "j1", propertyId: "p1", name: "Booked", status: "approved", jobNumber: 1, evaluationDate: "2026-05-01", projectStartDate: null, projectEndDate: null, createdAt: "2026-04-01" }],
      proposals: [],
    });
    expect(jo.lastActivityAt).toBe("2026-05-01");
  });

  it("is null for somebody with nothing on the books", () => {
    expect(tree({ properties: [], jobs: [], proposals: [] })[0].lastActivityAt).toBeNull();
  });
});

describe("projects on a property", () => {
  it("puts the most recent first", () => {
    // What somebody wants to know about an address is what happened last.
    const [jo] = tree({
      jobs: [
        { id: "old", propertyId: "p1", name: "Old", status: "completed", jobNumber: 1, evaluationDate: null, projectStartDate: null, projectEndDate: "2025-01-01", createdAt: "2025-01-01" },
        { id: "new", propertyId: "p1", name: "New", status: "completed", jobNumber: 2, evaluationDate: null, projectStartDate: null, projectEndDate: "2026-06-01", createdAt: "2026-05-01" },
      ],
      proposals: [],
    });
    expect(jo.properties[0].projects.map((p) => p.name)).toEqual(["New", "Old"]);
  });
});

describe("contactSummary", () => {
  it("reads who they are, what we have done, what it is worth", () => {
    expect(contactSummary(tree()[0])).toBe("1 property · 1 project · $5,200");
  });

  it("pluralises properly", () => {
    const [jo] = tree({
      properties: [
        { id: "p1", customerId: "c1", address: "A", acreage: null },
        { id: "p2", customerId: "c1", address: "B", acreage: null },
      ],
      jobs: [],
      proposals: [],
    });
    expect(contactSummary(jo)).toBe("2 properties · 0 projects");
  });

  it("says plainly when there is nothing to quote", () => {
    expect(contactSummary(tree({ properties: [], jobs: [], proposals: [] })[0])).toBe(
      "No property on file"
    );
  });

  it("uses no dashes", () => {
    expect(contactSummary(tree()[0])).not.toMatch(/[—–]/);
  });
});

describe("byOpportunity", () => {
  const people = buildContactTree({
    contacts: [
      { id: "live", name: "Live", email: null, phone: null, contactType: "client", doNotContact: false },
      { id: "rich", name: "Rich", email: null, phone: null, contactType: "client", doNotContact: false },
      { id: "quiet", name: "Quiet", email: null, phone: null, contactType: "client", doNotContact: false },
      { id: "stop", name: "Stop", email: null, phone: null, contactType: "client", doNotContact: true },
    ],
    properties: [
      { id: "pl", customerId: "live", address: "A", acreage: null },
      { id: "pr", customerId: "rich", address: "B", acreage: null },
      { id: "pq", customerId: "quiet", address: "C", acreage: null },
      { id: "ps", customerId: "stop", address: "D", acreage: null },
    ],
    jobs: [
      { id: "jl", propertyId: "pl", name: "Going", status: "in_progress", jobNumber: 1, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-01-01" },
      { id: "jr", propertyId: "pr", name: "Done", status: "completed", jobNumber: 2, evaluationDate: null, projectStartDate: null, projectEndDate: null, createdAt: "2026-01-01" },
    ],
    proposals: [{ jobId: "jr", status: "accepted", totalCost: 20000 }],
  });

  it("leads with a conversation already happening", () => {
    expect(byOpportunity(people)[0].name).toBe("Live");
  });

  it("then whoever has actually spent money", () => {
    expect(byOpportunity(people)[1].name).toBe("Rich");
  });

  it("never offers somebody who asked us not to call", () => {
    expect(byOpportunity(people).map((c) => c.name)).not.toContain("Stop");
  });

  it("does not reorder the caller's array", () => {
    const before = people.map((p) => p.name);
    byOpportunity(people);
    expect(people.map((p) => p.name)).toEqual(before);
  });
});

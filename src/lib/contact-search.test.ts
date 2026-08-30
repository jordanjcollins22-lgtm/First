import { describe, expect, it } from "vitest";

import { emptyLabel, matchesQuery, searchContacts } from "./contact-search";
import type { ContactRow } from "@/lib/data/contacts";

function contact(over: Partial<ContactRow> = {}): ContactRow {
  return {
    id: "1",
    name: "Jo Miller",
    email: "jo@example.com",
    phone: "410 555 0123",
    propertyCount: 1,
    addresses: ["4 Elm Road, Bel Air, MD 21014"],
    contactType: "client",
    statedType: "client",
    paidCents: 0,
    tags: [],
    doNotContact: false,
    pipelineStage: null,
    opportunityValue: null,
    ...over,
  };
}

describe("matchesQuery", () => {
  it("matches a name, however it is cased", () => {
    expect(matchesQuery(contact(), "jo")).toBe(true);
    expect(matchesQuery(contact(), "MILLER")).toBe(true);
  });

  it("matches an email and an address", () => {
    expect(matchesQuery(contact(), "example.com")).toBe(true);
    // "Who was the Elm Road one" is how people remember a customer.
    expect(matchesQuery(contact(), "elm road")).toBe(true);
  });

  it("matches a phone number typed with no spaces", () => {
    // Straight off a phone screen. It would never match "410 555 0123" as text.
    expect(matchesQuery(contact(), "4105550123")).toBe(true);
    expect(matchesQuery(contact(), "5550123")).toBe(true);
  });

  it("does not match on one or two stray digits", () => {
    // Without this, "1" matches every contact whose phone contains a one,
    // which is all of them, and the search looks broken on the first
    // keystroke.
    expect(matchesQuery(contact(), "1")).toBe(false);
    expect(matchesQuery(contact(), "41")).toBe(false);
  });

  it("still searches by a ZIP or a house number", () => {
    // Three digits is enough to be deliberate, so a postcode still works.
    expect(matchesQuery(contact(), "21014")).toBe(true);
  });

  it("takes words in any order", () => {
    expect(matchesQuery(contact(), "elm jo")).toBe(true);
    expect(matchesQuery(contact(), "jo elm")).toBe(true);
  });

  it("needs every word to appear somewhere", () => {
    expect(matchesQuery(contact(), "jo tarmac")).toBe(false);
  });

  it("matches everybody on an empty search", () => {
    expect(matchesQuery(contact(), "")).toBe(true);
    expect(matchesQuery(contact(), "   ")).toBe(true);
  });

  it("copes with a contact missing most of its fields", () => {
    const bare = contact({ email: null, phone: null, addresses: [] });
    expect(matchesQuery(bare, "miller")).toBe(true);
    expect(matchesQuery(bare, "elm")).toBe(false);
  });
});

describe("searchContacts", () => {
  const book = [
    contact({ id: "a", name: "Jo Miller" }),
    contact({ id: "b", name: "Sam Reed", email: null, phone: null, addresses: ["9 Oak Lane"] }),
    contact({ id: "c", name: "Pat Lowe", email: "pat@elsewhere.com", phone: null, addresses: [] }),
  ];

  it("returns the whole book for an empty search", () => {
    expect(searchContacts(book, "")).toHaveLength(3);
  });

  it("narrows to the matches", () => {
    expect(searchContacts(book, "oak").map((c) => c.id)).toEqual(["b"]);
    expect(searchContacts(book, "elsewhere").map((c) => c.id)).toEqual(["c"]);
  });

  it("returns nothing rather than everything when nothing matches", () => {
    expect(searchContacts(book, "zzzz")).toEqual([]);
  });
});

describe("emptyLabel", () => {
  it("names the search that found nothing", () => {
    expect(emptyLabel("elm")).toBe('Nobody matching "elm".');
  });

  it("says the book is empty when nothing was searched for", () => {
    expect(emptyLabel("")).toBe("No contacts yet.");
  });
});

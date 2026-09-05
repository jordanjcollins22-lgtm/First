import { describe, expect, it } from "vitest";

import {
  canDeleteContact,
  cleanContact,
  looksLikeSamePerson,
  validateContact,
} from "@/lib/contact-edit";

describe("cleanContact", () => {
  it("trims what somebody typed", () => {
    expect(cleanContact({ name: "  Mike Harrow ", email: " a@b.com ", phone: " 410 555 1234 " })).toEqual({
      name: "Mike Harrow",
      email: "a@b.com",
      phone: "410 555 1234",
    });
  });

  it("turns a blank into nothing, not into an empty value", () => {
    // The duplicate finder treats a blank as "unknown" and an empty string as
    // a value it could match on, so this distinction matters.
    expect(cleanContact({ name: "Mike", email: "   ", phone: "" })).toEqual({
      name: "Mike",
      email: null,
      phone: null,
    });
  });
});

describe("validateContact", () => {
  it("accepts a name on its own", () => {
    expect(validateContact({ name: "Mike Harrow", email: null, phone: null }).ok).toBe(true);
  });

  it("refuses a contact with no name", () => {
    expect(validateContact({ name: "   ", email: "a@b.com", phone: null }).ok).toBe(false);
  });

  it("refuses something that isn't an email", () => {
    const verdict = validateContact({ name: "Mike", email: "not-an-email", phone: null });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/email/i);
  });

  it("refuses a phone number too short to be one", () => {
    expect(validateContact({ name: "Mike", email: null, phone: "555" }).ok).toBe(false);
  });

  it("accepts a real number however it was punctuated", () => {
    expect(validateContact({ name: "Mike", email: null, phone: "(410) 555-1234" }).ok).toBe(true);
    expect(validateContact({ name: "Mike", email: null, phone: "+1 410 555 1234" }).ok).toBe(true);
  });
});

describe("canDeleteContact", () => {
  it("allows removing a contact with nothing attached", () => {
    expect(canDeleteContact({ propertyCount: 0, jobCount: 0 }).ok).toBe(true);
  });

  it("refuses when jobs would go with them, and says to merge instead", () => {
    // The difference between removing a mistyped duplicate and losing a
    // season of work on a real client.
    const verdict = canDeleteContact({ propertyCount: 1, jobCount: 3 });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toMatch(/merge/i);
    expect(verdict.ok === false && verdict.reason).toContain("3 jobs");
  });

  it("refuses when only properties are attached", () => {
    const verdict = canDeleteContact({ propertyCount: 1, jobCount: 0 });
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("1 property");
  });

  it("pluralises so the message reads properly", () => {
    const many = canDeleteContact({ propertyCount: 2, jobCount: 0 });
    expect(many.ok === false && many.reason).toContain("2 properties");
    const one = canDeleteContact({ propertyCount: 0, jobCount: 1 });
    expect(one.ok === false && one.reason).toContain("1 job");
  });
});

describe("looksLikeSamePerson", () => {
  const mike = { name: "Mike Harrow", email: "mike@x.com", phone: "410-555-1234" };

  it("matches on the same email, however it was cased", () => {
    expect(looksLikeSamePerson(mike, { ...mike, name: "M Harrow", email: "MIKE@X.COM" })).toBe(true);
  });

  it("matches on the same number, however it was punctuated", () => {
    expect(
      looksLikeSamePerson(mike, { name: "Mike", email: null, phone: "+1 (410) 555 1234" })
    ).toBe(true);
  });

  it("does not match two people who share only a name", () => {
    // Two people really can share a surname or a driveway.
    expect(
      looksLikeSamePerson(
        { name: "Mike Harrow", email: "a@x.com", phone: null },
        { name: "Mike Harrow", email: "b@x.com", phone: null }
      )
    ).toBe(false);
  });

  it("does not match on two blanks", () => {
    expect(
      looksLikeSamePerson(
        { name: "Mike", email: null, phone: null },
        { name: "Sarah", email: null, phone: null }
      )
    ).toBe(false);
  });

  it("does not match on a too-short number that happens to be identical", () => {
    expect(
      looksLikeSamePerson(
        { name: "A", email: null, phone: "555" },
        { name: "B", email: null, phone: "555" }
      )
    ).toBe(false);
  });
});

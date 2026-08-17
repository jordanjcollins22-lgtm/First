import { describe, expect, it } from "vitest";

import {
  findDuplicateCustomer,
  findDuplicateProperty,
  mergeableFields,
  normalizeAddress,
  normalizeEmail,
  normalizeName,
  normalizePhone,
} from "@/lib/dedupe";

describe("normalizeAddress", () => {
  it("treats long and short street types as the same", () => {
    expect(normalizeAddress("123 Main Street")).toBe(normalizeAddress("123 main st"));
    expect(normalizeAddress("9 Oak Road")).toBe(normalizeAddress("9 Oak Rd."));
  });

  it("ignores punctuation, casing, and stray spacing", () => {
    expect(normalizeAddress("  123  MAIN ST.  ")).toBe(normalizeAddress("123 Main St"));
  });

  it("keeps unit numbers apart", () => {
    expect(normalizeAddress("12 Main St Apt 2")).not.toBe(normalizeAddress("12 Main St Apt 3"));
  });

  it("matches # and Apt spellings of the same unit", () => {
    expect(normalizeAddress("12 Main St #2")).toBe(normalizeAddress("12 Main St Apt 2"));
  });

  it("keeps different houses on the same street apart", () => {
    expect(normalizeAddress("12 Main St")).not.toBe(normalizeAddress("14 Main St"));
  });
});

describe("normalizePhone", () => {
  it("matches the same number written any way", () => {
    expect(normalizePhone("(410) 555-0134")).toBe("4105550134");
    expect(normalizePhone("+1 410-555-0134")).toBe("4105550134");
    expect(normalizePhone("410.555.0134")).toBe("4105550134");
  });
});

describe("findDuplicateCustomer", () => {
  const existing = [
    { id: "c1", name: "Mike Johnson", email: "mike@example.com", phone: "410-555-0134" },
    { id: "c2", name: "Sarah Lee", email: null, phone: "443-555-0199" },
  ];

  it("matches on email first", () => {
    expect(findDuplicateCustomer(existing, { name: "M. Johnson", email: "MIKE@example.com" })?.id).toBe("c1");
  });

  it("matches on a full phone number when there's no email", () => {
    expect(findDuplicateCustomer(existing, { name: "S Lee", phone: "+1 (443) 555 0199" })?.id).toBe("c2");
  });

  it("matches on name when that's all there is", () => {
    expect(findDuplicateCustomer(existing, { name: "mike johnson" })?.id).toBe("c1");
  });

  it("does not match on a partial phone number", () => {
    expect(findDuplicateCustomer(existing, { phone: "5550134" })).toBeNull();
  });

  it("returns null for somebody genuinely new", () => {
    expect(findDuplicateCustomer(existing, { name: "Dana Cole", email: "dana@example.com" })).toBeNull();
  });
});

describe("findDuplicateProperty", () => {
  const existing = [
    { id: "p1", address: "123 Main Street" },
    { id: "p2", address: "45 Oak Rd" },
  ];

  it("finds the same address written differently", () => {
    expect(findDuplicateProperty(existing, "123 main st.")?.id).toBe("p1");
  });

  it("does not invent a match for a new address", () => {
    expect(findDuplicateProperty(existing, "77 Elm Ct")).toBeNull();
  });
});

describe("mergeableFields", () => {
  it("fills a blank from the new entry", () => {
    const patch = mergeableFields(
      { name: "Mike", email: null, phone: null },
      { name: "Mike", email: "mike@example.com", phone: "4105550134" }
    );
    expect(patch).toEqual({ email: "mike@example.com", phone: "4105550134" });
  });

  it("never overwrites something already recorded", () => {
    const patch = mergeableFields(
      { name: "Mike", email: "office@example.com", phone: null },
      { name: "Mike J", email: "typo@example.com", phone: "4105550134" }
    );
    expect(patch).toEqual({ phone: "4105550134" });
  });
});

describe("normalizers", () => {
  it("squashes names and emails consistently", () => {
    expect(normalizeName("  O'Brien,  Pat ")).toBe("obrien pat");
    expect(normalizeEmail("  Someone@Example.COM ")).toBe("someone@example.com");
  });
});

import { describe, expect, it } from "vitest";

import { businessKey, formatPhone, matchSorted, phoneKey, sortBrief, tidyBusiness } from "./post-sorting";

describe("phone numbers", () => {
  it("keys on the last ten digits", () => {
    expect(phoneKey("(410) 555-0101")).toBe("4105550101");
    expect(phoneKey("+1 410.555.0101")).toBe("4105550101");
    expect(phoneKey("call me")).toBeNull();
    expect(formatPhone("4105550101")).toBe("410-555-0101");
  });
});

describe("businessKey", () => {
  it("prefers the phone, then the email, then the name, then the person", () => {
    expect(businessKey({ phone: "410-555-0101", email: "a@b.com", name: "Green Co" })).toBe("phone:4105550101");
    expect(businessKey({ email: "Joe@Mow.com", name: "Joe's Mowing" })).toBe("email:joe@mow.com");
    expect(businessKey({ name: "Green Thumb Landscaping LLC" })).toBe("name:green thumb landscaping");
    expect(businessKey({ name: "Green Thumb Landscaping" })).toBe("name:green thumb landscaping");
    expect(businessKey({ person: "Mike Smith" })).toBe("person:mike smith");
    expect(businessKey({})).toBeNull();
  });
});

describe("tidyBusiness", () => {
  it("trims, checks the email, formats the phone and dedupes services", () => {
    expect(
      tidyBusiness(
        { name: "  Green  Co ", person: null, phone: "4105550101", email: "not an email", website: "greenco", services: ["Mowing", "mowing", " Mulch "], area: null },
        "Mike Smith"
      )
    ).toEqual({ name: "Green Co", person: "Mike Smith", phone: "410-555-0101", email: null, website: null, services: ["mowing", "mulch"], area: null });
  });
});

describe("matchSorted", () => {
  it("keeps only answers for posts that were asked about, first one wins", () => {
    const asked = [{ id: "1", author: null, group: null, text: "a" }, { id: "2", author: null, group: null, text: "b" }];
    const got = matchSorted(asked, [
      { id: "1", kind: "request", business: null },
      { id: "1", kind: "other", business: null },
      { id: "9", kind: "promotion", business: null },
    ]);
    expect(Array.from(got.keys())).toEqual(["1"]);
    expect(got.get("1")?.kind).toBe("request");
  });
});

describe("sortBrief", () => {
  it("numbers every post by its id", () => {
    const brief = sortBrief([{ id: "p1", author: "Jordan", group: "This Is Aberdeen", text: "Need my lawn mowed" }]);
    expect(brief).toContain('<post id="p1">');
    expect(brief).toContain("Posted by: Jordan");
    expect(brief).toContain("Group: This Is Aberdeen");
  });
});

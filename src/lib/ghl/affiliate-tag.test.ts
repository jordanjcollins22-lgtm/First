import { describe, expect, it } from "vitest";
import { creditTag, ghlAffiliateTag, ghlBookingLink, tagCheck, type TagPerson } from "./affiliate-tag";

const person = (over: Partial<TagPerson>): TagPerson => ({
  id: "p",
  firstName: null,
  lastName: null,
  fullName: null,
  affiliateSlug: null,
  isOwner: false,
  ...over,
});

const people: TagPerson[] = [
  person({ id: "jace", firstName: "Jace", lastName: "Burgess", affiliateSlug: "a1b2c3d4e5" }),
  person({ id: "justin", firstName: "Justin", lastName: "Owner", isOwner: true }),
  person({ id: "sam", fullName: "Sam Lee" }),
];

describe("GoHighLevel affiliate tag", () => {
  const widget = "https://links.example.com/widget/booking/CAL";

  it("reads am_id or ref off the page the contact booked on, the latest visit first", () => {
    expect(ghlAffiliateTag({ lastAttributionSource: { url: `${widget}?am_id=JaceBurgess465` } })).toBe("jaceburgess465");
    expect(ghlAffiliateTag({ attributionSource: { url: `${widget}?ref=a1b2c3d4e5&zip=1` } })).toBe("a1b2c3d4e5");
    expect(ghlAffiliateTag({ attributionSource: { url: `${widget}?ref=first` }, lastAttributionSource: { url: `${widget}?ref=last` } })).toBe("last");
  });

  it("falls back to the Affiliate Source field, and is null with no tag", () => {
    expect(ghlAffiliateTag({ customFields: [{ id: "aff", value: " Jace " }] }, "aff")).toBe("jace");
    expect(ghlAffiliateTag({ attributionSource: { url: `${widget}?zip=21201`, medium: "calendar" } }, "aff")).toBeNull();
    expect(ghlAffiliateTag({ attributionSource: { url: "not a url" } })).toBeNull();
    expect(ghlAffiliateTag(null)).toBeNull();
  });
});

describe("crediting a tag", () => {
  it("credits the person whose app code it is", () => {
    expect(creditTag("a1b2c3d4e5", people)).toEqual({ profileId: "jace", name: "Jace", earns: true });
  });

  it("credits the owner of a tracked link code", () => {
    expect(creditTag("k7m2p9x", people, new Map([["k7m2p9x", "sam"]]))).toEqual({ profileId: "sam", name: "Sam", earns: true });
  });

  it("credits a GoHighLevel affiliate id made of the person's name", () => {
    expect(creditTag("jaceburgess465", people)?.profileId).toBe("jace");
    expect(creditTag("samlee", people)?.profileId).toBe("sam");
    expect(creditTag("jace465", people)?.profileId).toBe("jace");
    expect(creditTag("justin2412", people)).toEqual({ profileId: "justin", name: "Justin", earns: false });
  });

  it("never pays an owner, but still says whose it was", () => {
    expect(creditTag("justinowner2412", people)).toEqual({ profileId: "justin", name: "Justin", earns: false });
  });

  it("credits nobody for an unknown, too short or shared tag", () => {
    expect(creditTag("someone99", people)).toBeNull();
    expect(creditTag("ab1", people)).toBeNull();
    expect(creditTag(null, people)).toBeNull();
    const twins = [person({ id: "a", firstName: "Jo", lastName: "Smith" }), person({ id: "b", fullName: "Jo Smith" })];
    expect(creditTag("josmith1", twins)).toBeNull();
    expect(creditTag("jace1", [...people, person({ id: "j2", firstName: "Jace", lastName: "Other" })])).toBeNull();
  });
});

describe("tagged GoHighLevel link and the monthly check", () => {
  it("puts the person's code on the booking page", () => {
    expect(ghlBookingLink("https://links.example.com/widget/booking/CAL", "a1b2c3d4e5")).toBe("https://links.example.com/widget/booking/CAL?ref=a1b2c3d4e5");
    expect(ghlBookingLink("", "x")).toBeNull();
    expect(ghlBookingLink("https://x.com", null)).toBeNull();
  });

  it("counts each tag with whom it went to", () => {
    const rows = tagCheck([
      { ghlTag: { tag: "jaceburgess465", person: "Jace", owner: false }, sold: true, collected: 1000 },
      { ghlTag: { tag: "jaceburgess465", person: "Jace", owner: false }, sold: false, collected: 0 },
      { ghlTag: { tag: "mystery1", person: null, owner: false }, sold: true, collected: 250.5 },
      { ghlTag: null, sold: true, collected: 99 },
    ]);
    expect(rows).toEqual([
      { tag: "jaceburgess465", person: "Jace", owner: false, leads: 2, sold: 1, collected: 1000 },
      { tag: "mystery1", person: null, owner: false, leads: 1, sold: 1, collected: 250.5 },
    ]);
  });
});

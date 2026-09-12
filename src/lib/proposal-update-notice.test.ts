import { describe, expect, it } from "vitest";

import {
  money,
  priceSentence,
  updateNoticeText,
  updateThreadNote,
  worthSending,
} from "./proposal-update-notice";

describe("priceSentence", () => {
  it("says what it costs now and what it was", () => {
    expect(priceSentence(100000, 70000)).toBe("Your total is now $700.00, down from $1,000.00.");
  });

  it("says up when it went up, rather than dressing it as a saving", () => {
    expect(priceSentence(70000, 100000)).toBe("Your total is now $1,000.00, up from $700.00.");
  });

  it("does not imply a movement that did not happen", () => {
    expect(priceSentence(70000, 70000)).toBe("The price is unchanged.");
  });
});

describe("updateNoticeText", () => {
  const base = {
    businessName: "JS Landscaping",
    changes: ["Removed Back bed (Mulch Install)"],
    previousTotalCents: 100000,
    newTotalCents: 70000,
    link: "https://app.jslandscapingmd.com/proposal/abc",
  };

  it("says who it is from, what changed, the new price, and the same link", () => {
    const out = updateNoticeText(base);
    expect(out.startsWith("JS Landscaping: we have updated your proposal.")).toBe(true);
    expect(out).toContain("Removed Back bed (Mulch Install).");
    expect(out).toContain("$700.00");
    expect(out).toContain("the same link: https://app.jslandscapingmd.com/proposal/abc");
  });

  it("names two changes and counts the rest", () => {
    const out = updateNoticeText({ ...base, changes: ["One", "Two", "Three", "Four"] });
    expect(out).toContain("One. Two. Plus 2 more.");
    expect(out).not.toContain("Three");
  });

  it("sends no link rather than a dead one", () => {
    const out = updateNoticeText({ ...base, link: null });
    expect(out).not.toContain("same link");
  });

  it("still reads as a message when only the price moved", () => {
    const out = updateNoticeText({ ...base, changes: [] });
    expect(out).toContain("updated your proposal");
    expect(out).toContain("$700.00");
  });

  it("names a sender even with no business name on file", () => {
    expect(updateNoticeText({ ...base, businessName: "" }).startsWith("Your crew:")).toBe(true);
  });
});

describe("updateThreadNote", () => {
  it("records on the job what the client was told", () => {
    expect(
      updateThreadNote({
        businessName: "JS Landscaping",
        changes: ["Removed Back bed"],
        previousTotalCents: 100000,
        newTotalCents: 70000,
      })
    ).toBe("Proposal update sent. Your total is now $700.00, down from $1,000.00. Removed Back bed.");
  });
});

describe("worthSending", () => {
  it("is worth it when something moved", () => {
    expect(worthSending({ changes: ["Removed X"], previousTotalCents: 100, newTotalCents: 100 })).toBe(true);
    expect(worthSending({ changes: [], previousTotalCents: 100, newTotalCents: 90 })).toBe(true);
  });

  it("is not worth texting somebody about a note nobody but us reads", () => {
    expect(worthSending({ changes: [], previousTotalCents: 100, newTotalCents: 100 })).toBe(false);
  });
});

describe("money", () => {
  it("reads as dollars", () => {
    expect(money(123456)).toBe("$1,234.56");
  });
});

import { describe, expect, it } from "vitest";

import { proposalReadyEmail } from "./proposal-ready-email";

describe("proposalReadyEmail", () => {
  const base = {
    clientName: "Jonathan Mazzone",
    address: "415 Harrington Road, Bel Air, Maryland 21015, United States",
    total: 650,
    discount: 0,
    validDays: 14,
    link: "https://app.example/proposal/abc",
    businessName: "JS Landscaping MD",
    signedBy: "Jordan",
  };

  it("hands over the link and how long it stands, and never the price", () => {
    const email = proposalReadyEmail(base);
    expect(email.subject).toBe("Your proposal from JS Landscaping MD");
    expect(email.text).toContain("Hi Jonathan,");
    expect(email.text).toContain("415 Harrington Road, Bel Air");
    expect(email.text).toContain("https://app.example/proposal/abc");
    expect(email.text).toContain("It's good for 14 days");
    expect(email.text).not.toContain("$");
    expect(email.text).toContain("Jordan, JS Landscaping MD");
  });

  it("keeps the price off even with a discount, and signs as the business when nobody is named", () => {
    expect(proposalReadyEmail({ ...base, total: 2115, discount: 235 }).text).not.toMatch(/\$|price/i);
    expect(proposalReadyEmail({ ...base, signedBy: null }).text.trim().endsWith("JS Landscaping MD")).toBe(true);
  });
});

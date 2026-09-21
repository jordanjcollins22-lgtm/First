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

  it("hands over the link, the price and how long it stands", () => {
    const email = proposalReadyEmail(base);
    expect(email.subject).toBe("Your proposal from JS Landscaping MD");
    expect(email.text).toContain("Hi Jonathan,");
    expect(email.text).toContain("415 Harrington Road, Bel Air");
    expect(email.text).toContain("https://app.example/proposal/abc");
    expect(email.text).toContain("The price is $650. It's good for 14 days");
    expect(email.text).toContain("Jordan, JS Landscaping MD");
  });

  it("mentions a discount only when there is one", () => {
    expect(proposalReadyEmail({ ...base, total: 2115, discount: 235 }).text).toContain("The price is $2,115, with $235 already taken off.");
    expect(proposalReadyEmail({ ...base, signedBy: null }).text.trim().endsWith("JS Landscaping MD")).toBe(true);
  });
});

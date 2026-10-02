import { describe, expect, it } from "vitest";

import { paidAlert, requestAlert, welcomeEmail } from "@/lib/mow-messages";

describe("quick mow messages", () => {
  it("tells the team to call within two minutes", () => {
    expect(requestAlert({ name: "Alex Sample", phone: "(410) 555-0100", address: "12 Sample Ct", price: "$46" })).toBe(
      "New quick mow request: Alex Sample, (410) 555-0100. 12 Sample Ct. Saw $46 for the first mow. Not paid yet. Call within 2 minutes."
    );
    expect(paidAlert({ name: "Alex Sample", phone: "(410) 555-0100", address: "12 Sample Ct", paid: "$46", day: "Tue, Oct 6" })).toContain("Call now to confirm");
  });

  it("quotes real reviews only, and none when there are none", () => {
    const base = { firstName: "Alex", address: "12 Sample Ct", day: "Tue, Oct 6", paid: "$46", business: "Sample Landscaping", phone: "(410) 555-0100", sender: "Pat" };
    const withReviews = welcomeEmail({ ...base, reviews: [{ author: "Sam R.", body: "Great job, on time." }] });
    expect(withReviews.body).toContain('"Great job, on time."\nSam R.');
    expect(withReviews.subject).toBe("Your first mow on Tue, Oct 6");
    const without = welcomeEmail({ ...base, reviews: [] });
    expect(without.body).not.toContain("What our clients say");
  });

  it("uses no dashes anywhere a client reads", () => {
    const { subject, body } = welcomeEmail({ firstName: "Alex", address: "12 Sample Ct", day: "Tue, Oct 6", paid: "$46", business: "B", phone: null, sender: null, reviews: [] });
    expect(`${subject} ${body}`).not.toMatch(/[—–]/);
  });
});

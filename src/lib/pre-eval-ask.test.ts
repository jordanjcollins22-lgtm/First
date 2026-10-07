import { describe, expect, it } from "vitest";

import { preEvalAskEmail } from "@/lib/pre-eval-ask";

const base = {
  clientName: "Pat Example",
  address: "12 Sample Lane, Bel Air, Maryland 21014, United States",
  dueAt: "2026-10-01T22:00:00Z",
  evaluator: "Jace",
  link: "https://app.example.com/prep/abc123",
  sender: "Jordan Collins",
  business: "JS Landscaping MD",
  phone: "443-819-1521",
  now: new Date("2026-10-01T13:00:00Z"),
};

describe("preEvalAskEmail", () => {
  it("asks for the form, gives the link, and says otherwise it is the first five to ten minutes", () => {
    const { subject, body } = preEvalAskEmail(base);
    expect(subject).toBe("A quick form before your visit");
    expect(body).toContain("Hi Pat,");
    expect(body).toContain("Jace is coming out to 12 Sample Lane today at 6:00 PM.");
    expect(body).toContain("https://app.example.com/prep/abc123");
    expect(body).toContain("in the first five to ten minutes of the appointment");
    expect(body.endsWith("Thank you,\nJordan Collins\nJS Landscaping MD\n443-819-1521")).toBe(true);
  });

  it("says tomorrow, or the day, when it is not today", () => {
    expect(preEvalAskEmail({ ...base, dueAt: "2026-10-02T14:00:00Z" }).body).toContain("tomorrow at 10:00 AM");
    expect(preEvalAskEmail({ ...base, dueAt: "2026-10-06T14:00:00Z" }).body).toContain("on Tuesday, October 6 at 10:00 AM");
  });

  it("reads right with nobody assigned and no name", () => {
    const { body } = preEvalAskEmail({ ...base, evaluator: null, clientName: null, sender: null, phone: null });
    expect(body).toContain("Hi there,");
    expect(body).toContain("We are coming out to 12 Sample Lane");
    expect(body.endsWith("Thank you,\nJS Landscaping MD")).toBe(true);
  });
});

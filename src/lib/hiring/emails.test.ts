import { describe, expect, it } from "vitest";

import { applicantEmail, isAcceptance, stageAfter, welcomeEmail } from "@/lib/hiring/emails";

const BASE = { firstName: "Sam", positionTitle: "Landscape Project Lead", business: "Sample Landscaping", phone: "(410) 555-0100", sender: "Pat" };

describe("applicant emails", () => {
  it("invites to an interview with the time and place", () => {
    const { subject, body } = applicantEmail({ ...BASE, kind: "interview", when: "Tue, Oct 6, 10:00 AM", place: "12 Sample Rd" });
    expect(subject).toBe("Interview for Landscape Project Lead with Sample Landscaping");
    expect(body).toContain("on Tue, Oct 6, 10:00 AM");
    expect(body).toContain("Where: 12 Sample Rd");
    expect(body).toContain("(410) 555-0100");
    expect(body.endsWith("Pat\nSample Landscaping")).toBe(true);
  });

  it("says the address will follow when there isn't one", () => {
    const { body } = applicantEmail({ ...BASE, kind: "interview", when: null, place: null });
    expect(body).toContain("We'll send you the address the day before.");
    expect(body).not.toContain(" on ");
  });

  it("gives the video link when asking for a video", () => {
    const { body } = applicantEmail({ ...BASE, kind: "video_request", videoUrl: "https://example.com/careers/video/abc" });
    expect(body).toContain("https://example.com/careers/video/abc");
  });

  it("turns someone down kindly and gives no reason", () => {
    const { body } = applicantEmail({ ...BASE, kind: "not_a_fit" });
    expect(body).toContain("move forward with other applicants");
    expect(body.toLowerCase()).not.toMatch(/because|reason|failed/);
  });

  it("uses no dashes anywhere an applicant reads", () => {
    for (const kind of ["interview", "not_a_fit", "video_request", "offer"] as const) {
      const { subject, body } = applicantEmail({ ...BASE, kind, when: "Tue, Oct 6, 10:00 AM", videoUrl: "https://example.com/v" });
      expect(`${subject} ${body}`).not.toMatch(/[—–]/);
    }
  });

  it("moves the application to match what was sent", () => {
    expect(stageAfter("interview")).toBe("interview");
    expect(stageAfter("not_a_fit")).toBe("not_a_fit");
    expect(stageAfter("video_request")).toBe("video_requested");
    expect(stageAfter("offer")).toBe("offer_sent");
  });

  it("makes the offer with the pay, the first days, the gear and how to accept", () => {
    const { subject, body } = applicantEmail({ ...BASE, kind: "offer", positionTitle: "Landscape Project Technician", positionKey: "project-technician", pay: "$15 to $36 an hour" });
    expect(subject).toBe("Your offer for Landscape Project Technician with Sample Landscaping");
    expect(body).toContain("Pay: $15 to $36 an hour.");
    expect(body).toContain("6:50 AM");
    expect(body).toContain("work boots");
    expect(body).toContain('reply to this email with "I accept"');
    expect(body).toContain("48 hours");
  });

  it("leaves crew gear out of an office or online offer", () => {
    const { body } = applicantEmail({ ...BASE, kind: "offer", positionTitle: "Affiliate", positionKey: "affiliate", pay: null });
    expect(body).not.toContain("boots");
    expect(body).not.toContain("Pay:");
  });
});

describe("accepting an offer", () => {
  it("takes a plain yes", () => {
    for (const yes of ["I accept", "I accept!", "Yes, I accept. Thank you!", "i do accept", "I happily accept the offer"]) expect(isAcceptance(yes)).toBe(true);
  });

  it("leaves anything unsure for a person", () => {
    for (const unsure of ["I don't accept", "I can't accept this", "I accept, but can I start in a month?", "Do I accept by replying?", "Thanks so much!", ""]) {
      expect(isAcceptance(unsure)).toBe(false);
    }
  });

  it("welcomes a tech with day one at the shop and a trainer", () => {
    const { subject, body } = welcomeEmail({ firstName: "Sam", positionTitle: "Landscape Project Technician", positionKey: "project-technician", business: "Sample Landscaping", phone: "(410) 555-0100", sender: null });
    expect(subject).toBe("Welcome to Sample Landscaping");
    expect(body).toContain("6:50 AM");
    expect(body).toContain("trainer");
    expect(body).toContain("(410) 555-0100");
    expect(`${subject} ${body}`).not.toMatch(/[—–]/);
  });
});

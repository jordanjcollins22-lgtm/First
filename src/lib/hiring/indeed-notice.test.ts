import { describe, expect, it } from "vitest";

import { applyInvite, isFromIndeed, nameIn, positionIn, readIndeedNotice, relayIn, tidyName } from "@/lib/hiring/indeed-notice";

const application = {
  from: "Indeed <indeedapply@indeed.com>",
  subject: "New application: Landscape Project Technician - Sample Applicant",
  text: "Sample Applicant applied to your job Landscape Project Technician in Aberdeen, MD. Reply to this email to message them.",
  html: null,
  replyTo: ["Sample Applicant <sample-applicant-4f2a@indeedemail.com>"],
};

describe("Indeed's application email", () => {
  it("reads one applicant: name, job and the address that reaches them", () => {
    expect(readIndeedNotice(application)).toEqual({ name: "Sample Applicant", position: "project-technician", relay: "sample-applicant-4f2a@indeedemail.com" });
  });

  it("finds the address in the body when there is no reply-to", () => {
    expect(relayIn({ ...application, replyTo: null, text: "Message them at x7y8z9@indeedemail.com" })).toBe("x7y8z9@indeedemail.com");
  });

  it("leaves out the daily round-up and other Indeed mail", () => {
    expect(readIndeedNotice({ ...application, subject: "New candidates Monday debrief", replyTo: null })).toBeNull();
    expect(readIndeedNotice({ ...application, subject: "Your job is live", text: "Landscape Evaluator", replyTo: null })).toBeNull();
    expect(readIndeedNotice({ ...application, from: "someone@example.com" })).toBeNull();
  });

  it("takes a hand-forwarded one", () => {
    expect(isFromIndeed({ ...application, from: "owner@example.com", subject: "Fwd: " + application.subject, text: "---------- Forwarded message ---------\nFrom: Indeed <indeedapply@indeed.com>" })).toBe(true);
  });

  it("knows the jobs by their Indeed titles", () => {
    expect(positionIn("Landscape Project Lead")).toBe("project-lead");
    expect(positionIn("Landscape Project Technician")).toBe("project-technician");
    expect(positionIn("Landscape Evaluator")).toBe("evaluator");
    expect(positionIn("Account Manager (commission)")).toBe("account-manager");
    expect(positionIn("Something else")).toBeNull();
  });

  it("reads the name in the usual subjects", () => {
    expect(nameIn("Sample Person applied to Landscape Evaluator")).toBe("Sample Person");
    expect(nameIn("New candidate for Landscape Project Lead: SAMPLE PERSON")).toBe("Sample Person");
    expect(nameIn("Landscape Evaluator")).toBeNull();
    expect(tidyName("Ann DiNapoli")).toBe("Ann DiNapoli");
  });

  it("writes the invite as approved", () => {
    const mail = applyInvite({ name: "Sample Applicant", positionTitle: "Landscape Project Technician", applyUrl: "https://example.com/careers/project-technician?src=indeed", sender: "Jordan", business: "JS Landscaping" });
    expect(mail.subject).toBe("Next step for your application – JS Landscaping");
    expect(mail.text.startsWith("Hi Sample,\n\nThanks for applying for the Landscape Project Technician job on Indeed.")).toBe(true);
    expect(mail.text).toContain("https://example.com/careers/project-technician?src=indeed");
    expect(applyInvite({ name: null, positionTitle: "X", applyUrl: "u", sender: "J", business: "B" }).text.startsWith("Hi there,")).toBe(true);
  });
});

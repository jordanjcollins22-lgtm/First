import { describe, expect, it } from "vitest";

import { applyInvite, applyReminder, isFromIndeed, isIndeedAddress, nameIn, nameInBody, positionIn, readIndeedNotice, relayIn, tidyName } from "@/lib/hiring/indeed-notice";

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

describe("Indeed's application email sent from the applicant's relay address", () => {
  // As it arrives today: from the conversation address, which is also how to reach them.
  const relayed = {
    from: "conversation-sampleperson-landscapeprojectlead-1rd@indeedemail.com",
    subject: "[Action required] New application for Landscape Project Lead, Aberdeen, MD",
    text: "Sample Person applied to your job\nLandscape Project Lead\nAberdeen, MD",
    html: null,
    replyTo: null,
  };

  it("is Indeed's, and reads the job, the address and the name", () => {
    expect(isIndeedAddress("conversation-x-1rd@indeedemail.com")).toBe(true);
    expect(isIndeedAddress("someone@notindeedemail.com")).toBe(false);
    expect(readIndeedNotice(relayed)).toEqual({
      name: "Sample Person",
      position: "project-lead",
      relay: "conversation-sampleperson-landscapeprojectlead-1rd@indeedemail.com",
    });
  });

  it("knows each job from the subject", () => {
    expect(readIndeedNotice({ ...relayed, subject: "[Action required] New application for Landscape Evaluator", text: "" })?.position).toBe("evaluator");
    expect(readIndeedNotice({ ...relayed, subject: "[Action required] New application for Landscape Project Technician", text: "" })?.position).toBe("project-technician");
  });

  it("greets by name only when the email gives one", () => {
    expect(readIndeedNotice({ ...relayed, text: "Review this candidate on Indeed." })?.name).toBeNull();
    expect(nameInBody("You have a new application from SAMPLE PERSON")).toBe("Sample Person");
    expect(nameInBody("Indeed applied filters")).toBeNull();
  });

  it("leaves the applicant's replies to be passed on, not answered with another invite", () => {
    expect(readIndeedNotice({ ...relayed, subject: "Re: Next step for your application – JS Landscaping", text: "Landscape Project Lead, sounds good" })).toBeNull();
    expect(readIndeedNotice({ ...relayed, subject: "Question about the job", text: "Landscape Project Lead" })).toBeNull();
  });

  it("strips Indeed's bracketed tag before reading a name from the subject", () => {
    expect(nameIn("[Action required] Sample Person applied to Landscape Evaluator")).toBe("Sample Person");
  });
});

describe("the one reminder", () => {
  it("points them back at the same link and asks for their own email", () => {
    const mail = applyReminder({ name: "Sample Applicant", positionTitle: "Landscape Evaluator", applyUrl: "https://example.com/careers/evaluator?src=indeed&inv=abc", sender: "Jordan", business: "JS Landscaping" });
    expect(mail.subject).toBe("Still interested? – JS Landscaping");
    expect(mail.text.startsWith("Hi Sample,")).toBe(true);
    expect(mail.text).toContain("https://example.com/careers/evaluator?src=indeed&inv=abc");
    expect(mail.text).toContain("personal email");
  });
});

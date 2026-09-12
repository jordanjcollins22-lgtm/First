import { describe, expect, it } from "vitest";

import { composeReminder, fitSms, sayWhen, SMS_LIMIT } from "@/lib/client-message-templates";
import { DEFAULT_RULES } from "@/lib/client-reminders";

const FACTS = {
  businessName: "JS Landscaping",
  clientName: "Linda Alvarez",
  when: "tomorrow at 9am",
  address: "14 Willow Road",
};

describe("what a reminder says", () => {
  it("says who it is from, first, on a text", () => {
    // A text that does not say who it is from is one somebody reports.
    const { body } = composeReminder("evaluation_reminder", "sms", FACTS);
    expect(body.startsWith("JS Landscaping:")).toBe(true);
  });

  it("says how to stop on the first text to a number", () => {
    const { body } = composeReminder("evaluation_reminder", "sms", FACTS, { includeOptOut: true });
    expect(body).toContain("Reply STOP to stop.");
  });

  it("does not repeat the opt-out on every later text", () => {
    // Required once, and tiresome every time after that.
    const { body } = composeReminder("evaluation_reminder", "sms", FACTS);
    expect(body).not.toContain("Reply STOP");
  });

  it("puts a way to unsubscribe in an email", () => {
    // An email with no way out is what gets a sending domain blocked.
    const { body } = composeReminder("proposal_follow_up", "email", FACTS, {
      unsubscribeUrl: "https://example.com/u/abc",
    });
    expect(body).toContain("https://example.com/u/abc");
  });

  it("gives an email a subject and a text no subject", () => {
    expect(composeReminder("evaluation_reminder", "email", FACTS).subject.length).toBeGreaterThan(0);
    expect(composeReminder("evaluation_reminder", "sms", FACTS).subject).toBe("");
  });

  it("uses the client's first name and not their whole name", () => {
    expect(composeReminder("evaluation_reminder", "sms", FACTS).body).toContain("Hi Linda");
    expect(composeReminder("evaluation_reminder", "sms", FACTS).body).not.toContain("Alvarez");
  });

  it("still reads properly for somebody with no name on file", () => {
    const body = composeReminder("evaluation_reminder", "sms", { ...FACTS, clientName: null }).body;
    expect(body).not.toContain("Hi ,");
    expect(body.length).toBeGreaterThan(20);
  });

  it("says something for every reminder the app can send", () => {
    for (const rule of DEFAULT_RULES) {
      for (const channel of ["sms", "email"] as const) {
        const message = composeReminder(rule.kind, channel, FACTS);
        expect(message.body.length).toBeGreaterThan(20);
        if (channel === "email") expect(message.subject.length).toBeGreaterThan(0);
      }
    }
  });

  it("includes the link when there is one to include", () => {
    const { body } = composeReminder("proposal_follow_up", "email", {
      ...FACTS,
      link: "https://example.com/proposal/xyz",
    });
    expect(body).toContain("https://example.com/proposal/xyz");
  });

  it("offers to move an appointment rather than just announcing it", () => {
    expect(composeReminder("evaluation_reminder", "sms", FACTS).body.toLowerCase()).toContain("move it");
  });

  it("gives somebody who has already paid a way to say so", () => {
    expect(composeReminder("invoice_reminder", "email", FACTS).body.toLowerCase()).toContain("already");
  });
});

describe("keeping a text to one message", () => {
  it("leaves a short one alone", () => {
    expect(fitSms("Short one.")).toBe("Short one.");
  });

  it("cuts a long one at a sentence", () => {
    const long = `${"One sentence here. ".repeat(30)}`;
    const cut = fitSms(long);
    expect(cut.length).toBeLessThanOrEqual(SMS_LIMIT);
    expect(cut.endsWith(".")).toBe(true);
  });

  it("cuts with an ellipsis when there is no sentence to cut at", () => {
    const cut = fitSms("x".repeat(500));
    expect(cut.length).toBeLessThanOrEqual(SMS_LIMIT);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("how a moment reads in a message", () => {
  const ZONE = "America/New_York";
  const NOW = new Date("2026-03-10T15:00:00Z"); // Tuesday morning in Maryland.

  it("says today for today", () => {
    expect(sayWhen(new Date("2026-03-10T19:00:00Z"), ZONE, NOW)).toBe("today at 3pm");
  });

  it("says tomorrow for tomorrow", () => {
    expect(sayWhen(new Date("2026-03-11T13:00:00Z"), ZONE, NOW)).toBe("tomorrow at 9am");
  });

  it("names the day inside the week", () => {
    expect(sayWhen(new Date("2026-03-13T13:00:00Z"), ZONE, NOW)).toBe("Friday at 9am");
  });

  it("gives the date once it is far enough away to need one", () => {
    expect(sayWhen(new Date("2026-03-24T13:00:00Z"), ZONE, NOW)).toContain("March 24");
  });

  it("keeps the minutes when there are minutes", () => {
    expect(sayWhen(new Date("2026-03-11T13:30:00Z"), ZONE, NOW)).toBe("tomorrow at 9:30am");
  });

  it("reads the client's clock, not the server's", () => {
    // 13:00 UTC is 9am in Maryland, and saying 1pm would send somebody out
    // four hours late.
    expect(sayWhen(new Date("2026-03-11T13:00:00Z"), ZONE, NOW)).toContain("9am");
  });
});

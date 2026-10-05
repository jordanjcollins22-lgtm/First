import { describe, expect, it } from "vitest";

import { bestEmail, emailFooter, extractEmails, hostOf, inSendWindow, seasonFor, sendBlocker, stepSchedule } from "@/lib/pm-outreach";

describe("extractEmails", () => {
  it("finds addresses, mailto links and dressed-up ones, and drops junk", () => {
    const html = `<a href="mailto:Info@SampleRealty.com">Email</a> office&#64;samplerealty.com
      <img src="logo@2x.png"> noreply@samplerealty.com someone@example.com jobs@samplerealty.com.`;
    expect(extractEmails(html).sort()).toEqual(["info@samplerealty.com", "jobs@samplerealty.com", "office@samplerealty.com"]);
  });
});

describe("bestEmail", () => {
  it("prefers the office on the company's own domain, never tenants or careers", () => {
    expect(bestEmail(["jobs@samplerealty.com", "maintenance@samplerealty.com", "info@samplerealty.com", "x@gmail.com"], "https://www.samplerealty.com")).toBe("info@samplerealty.com");
    expect(bestEmail(["leasing@samplerealty.com", "careers@samplerealty.com"], "samplerealty.com")).toBeNull();
    expect(bestEmail(["pat.sample@samplerealty.com", "sampleguy@gmail.com"], "samplerealty.com")).toBe("pat.sample@samplerealty.com");
  });

  it("reads the site's host", () => {
    expect(hostOf("www.Sample.com/contact")).toBe("sample.com");
  });
});

describe("the send window", () => {
  it("is weekdays 8am to 4pm Eastern", () => {
    expect(inSendWindow(new Date("2026-10-06T14:00:00Z"))).toBe(true); // Tue 10am
    expect(inSendWindow(new Date("2026-10-06T21:00:00Z"))).toBe(false); // Tue 5pm
    expect(inSendWindow(new Date("2026-10-04T14:00:00Z"))).toBe(false); // Sun
  });

  it("schedules the three emails on weekdays, 0, 3 and 7 business days apart", () => {
    const [a, b, c] = stepSchedule(new Date("2026-10-09T20:00:00Z"), "company-1"); // Fri 4pm
    const day = (d: Date) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" }).format(d);
    expect(day(a)).toBe("Mon");
    expect(day(b)).toBe("Thu");
    expect(day(c)).toBe("Wed");
    expect(c.getTime() - a.getTime()).toBe(9 * 86_400_000);
  });
});

describe("what every email carries", () => {
  it("has the business, its address and a way out", () => {
    const footer = emailFooter({ businessName: "JS Landscaping MD", address: "1 Sample St, Bel Air, MD", unsubscribeUrl: "https://x/u/abc" });
    expect(footer).toContain("1 Sample St, Bel Air, MD");
    expect(footer).toContain("https://x/u/abc");
  });

  it("will not send without an address or a mailbox", () => {
    expect(sendBlocker({ sendingOn: true, mailbox: true, address: "" })).toMatch(/street address/);
    expect(sendBlocker({ sendingOn: true, mailbox: false, address: "1 Sample St" })).toMatch(/mailbox/);
    expect(sendBlocker({ sendingOn: true, mailbox: true, address: "1 Sample St" })).toBeNull();
  });

  it("leads with snow in the fall and winter", () => {
    expect(seasonFor(new Date("2026-10-05T12:00:00Z"))).toBe("snow");
    expect(seasonFor(new Date("2027-04-05T12:00:00Z"))).toBe("spring");
  });
});

describe("allowedToday", () => {
  it("starts at five and builds up, never past the cap", async () => {
    const { allowedToday } = await import("@/lib/pm-outreach");
    const now = new Date("2026-10-20T14:00:00Z");
    expect(allowedToday({ cap: 20, firstSentAt: null, sentToday: 0, now })).toBe(5);
    expect(allowedToday({ cap: 20, firstSentAt: "2026-10-17T14:00:00Z", sentToday: 4, now })).toBe(10);
    expect(allowedToday({ cap: 20, firstSentAt: "2026-09-01T14:00:00Z", sentToday: 0, now })).toBe(20);
    expect(allowedToday({ cap: 20, firstSentAt: "2026-09-01T14:00:00Z", sentToday: 25, now })).toBe(0);
  });
});

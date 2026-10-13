import { describe, expect, it } from "vitest";

import { classifyMissedVisit, GHL_NO_SHOW_REASON, rebookDedupeKey, rebookMessage, rebookStepsDue } from "@/lib/client-automations/no-show";
import { automaticOutcome, isMissedDial, missedCallKey, missedCallText, textableCaller } from "@/lib/client-automations/calls";
import { reachableChannels, textElseEmail } from "@/lib/client-automations/channels";

describe("classifyMissedVisit", () => {
  it("reads who called it off from the reason", () => {
    expect(classifyMissedVisit("No-show")).toBe("no_show");
    expect(classifyMissedVisit(GHL_NO_SHOW_REASON)).toBe("no_show");
    expect(classifyMissedVisit("nobody home, knocked twice")).toBe("no_show");
    expect(classifyMissedVisit("Client cancelled")).toBe("client_cancelled");
    expect(classifyMissedVisit("Cancelled in GoHighLevel.")).toBe("client_cancelled");
    expect(classifyMissedVisit("she can't make it this week")).toBe("client_cancelled");
  });
  it("leaves alone anything the office cancelled, or anything unclear", () => {
    expect(classifyMissedVisit("Duplicate booking")).toBeNull();
    expect(classifyMissedVisit("test")).toBeNull();
    expect(classifyMissedVisit("out of area")).toBeNull();
    expect(classifyMissedVisit("weather")).toBeNull();
    expect(classifyMissedVisit("")).toBeNull();
    expect(classifyMissedVisit(null)).toBeNull();
    expect(classifyMissedVisit("evaluator sick")).toBeNull();
  });
});

describe("rebookStepsDue", () => {
  const anchor = new Date("2026-10-10T18:00:00Z");
  it("is the same day, then day 3, each once", () => {
    expect(rebookStepsDue({ anchor, days: [0, 3], now: new Date("2026-10-10T18:10:00Z") })).toEqual([0]);
    expect(rebookStepsDue({ anchor, days: [0, 3], now: new Date("2026-10-12T18:10:00Z") })).toEqual([]);
    expect(rebookStepsDue({ anchor, days: [0, 3], now: new Date("2026-10-13T19:00:00Z") })).toEqual([3]);
    expect(rebookDedupeKey("j1", 3, "sms")).toBe("no_show_rebook:j1:3:sms");
  });
  it("links to /book", () => {
    const msg = rebookMessage({ kind: "no_show", day: 0, channel: "sms", businessName: "JS", clientName: "Ann", link: "https://x/book" });
    expect(msg.body).toContain("sorry we missed each other");
    expect(msg.body).toContain("https://x/book");
  });
});

describe("calls", () => {
  it("knows a missed call from an answered one", () => {
    expect(isMissedDial("no-answer")).toBe(true);
    expect(isMissedDial("busy")).toBe(true);
    expect(isMissedDial("canceled")).toBe(true);
    expect(isMissedDial("completed")).toBe(false);
  });
  it("texts each number once a day, and only real numbers", () => {
    expect(missedCallKey("+1 (410) 555-0101", "2026-10-13")).toBe("missed_call_text:4105550101:2026-10-13");
    expect(missedCallKey("4105550101", "2026-10-13")).toBe(missedCallKey("+14105550101", "2026-10-13"));
    expect(textableCaller("+14105550101")).toBe(true);
    expect(textableCaller("anonymous")).toBe(false);
    expect(textableCaller("+12345")).toBe(false);
    expect(textableCaller("+10105550101")).toBe(false);
  });
  it("says sorry and offers both ways back", () => {
    const text = missedCallText({ businessName: "JS", bookLink: "https://x/book", includeOptOut: false });
    expect(text).toContain("Sorry we missed you");
    expect(text).toContain("https://x/book");
    expect(text).toContain("reply");
  });
  it("logs an unanswered click-to-call as no answer, and holds a conversation for a person", () => {
    expect(automaticOutcome("outbound", "no-answer", 0)).toBe("no_answer");
    expect(automaticOutcome("outbound", "completed", 8)).toBe("no_answer");
    expect(automaticOutcome("outbound", "completed", 140)).toBe("needs_disposition");
    expect(automaticOutcome("inbound", "completed", 140)).toBe("needs_disposition");
    expect(automaticOutcome("inbound", "no-answer", 0)).toBeNull();
  });
});

describe("channels", () => {
  const contact = { phone: "4105550101", email: "a@b.co", doNotContact: false, smsConsent: "unknown" as const, emailConsent: "unknown" as const };
  const ready = { sms: true, email: true };
  it("texts first and falls back to email", () => {
    expect(textElseEmail(contact, "service", ready)).toBe("sms");
    expect(textElseEmail({ ...contact, phone: null }, "service", ready)).toBe("email");
    expect(textElseEmail({ ...contact, smsConsent: "revoked" }, "service", ready)).toBe("email");
    expect(textElseEmail(contact, "service", { sms: false, email: true })).toBe("email");
    expect(textElseEmail({ ...contact, doNotContact: true }, "service", ready)).toBeNull();
  });
  it("needs a yes on file for marketing", () => {
    expect(textElseEmail(contact, "marketing", ready)).toBeNull();
    expect(reachableChannels({ ...contact, emailConsent: "granted" }, "marketing", ready)).toEqual(["email"]);
  });
});

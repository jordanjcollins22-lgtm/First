import { describe, expect, it } from "vitest";

import {
  BODY_LIMIT,
  clientMessageText,
  internalNoteText,
  messageDedupeKey,
  teamMessageText,
  truncateForSms,
} from "./message-notify";

describe("truncateForSms", () => {
  it("leaves a short message alone, with no ellipsis", () => {
    expect(truncateForSms("Running ten minutes late.")).toBe("Running ten minutes late.");
  });

  it("collapses the newlines a phone keyboard puts in", () => {
    expect(truncateForSms("Line one\n\nline two")).toBe("Line one line two");
  });

  it("cuts a long message at a word boundary", () => {
    const long = "word ".repeat(60).trim();
    const out = truncateForSms(long);
    expect(out.length).toBeLessThanOrEqual(BODY_LIMIT + 1);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("wor…");
  });

  it("cuts mid-word rather than throwing most of it away", () => {
    const out = truncateForSms(`${"a".repeat(200)} tail`, 20);
    expect(out).toBe(`${"a".repeat(20)}…`);
  });
});

describe("clientMessageText", () => {
  it("leads with who it is from and ends with the way back", () => {
    const out = clientMessageText({
      businessName: "JS Landscaping",
      body: "We can start Tuesday.",
      link: "https://app.jslandscapingmd.com/proposal/abc",
    });
    expect(out.startsWith("JS Landscaping: We can start Tuesday.")).toBe(true);
    expect(out).toContain("Reply here: https://app.jslandscapingmd.com/proposal/abc");
  });

  it("sends no link rather than a dead one", () => {
    const out = clientMessageText({ businessName: "JS Landscaping", body: "Hi" });
    expect(out).toBe("JS Landscaping: Hi");
    expect(out).not.toContain("Reply here");
  });

  it("still names a sender when the business name is missing", () => {
    expect(clientMessageText({ businessName: "  ", body: "Hi" })).toBe("Your crew: Hi");
  });
});

describe("teamMessageText", () => {
  it("names the client so the crew knows whose thread to open", () => {
    expect(teamMessageText({ clientName: "Dana Ruiz", body: "Can you come Friday?" })).toBe(
      "Dana Ruiz messaged: Can you come Friday?"
    );
  });

  it("falls back when the client did not give a name", () => {
    expect(teamMessageText({ clientName: "", body: "Hi" }).startsWith("A client messaged:")).toBe(true);
  });
});

describe("internalNoteText", () => {
  it("says who wrote it and which job", () => {
    expect(
      internalNoteText({ authorName: "Sam", jobLabel: "12 Oak St", body: "Gate code is 4410." })
    ).toBe("Sam on 12 Oak St: Gate code is 4410.");
  });

  it("drops the job when there is nothing to call it", () => {
    expect(internalNoteText({ authorName: "Sam", jobLabel: "", body: "Note" })).toBe("Sam: Note");
  });
});

describe("messageDedupeKey", () => {
  it("is unique per message so a retry cannot text twice", () => {
    expect(messageDedupeKey("m1")).toBe("message:m1");
    expect(messageDedupeKey("m1")).not.toBe(messageDedupeKey("m2"));
  });
});

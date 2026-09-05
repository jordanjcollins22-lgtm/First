import { describe, expect, it } from "vitest";

import {
  channelLabel,
  dayLabel,
  groupByDay,
  messageTime,
  reachLine,
  type ThreadMessage,
} from "./message-thread";

const NOW = new Date("2026-08-28T15:00:00Z");

function msg(over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: Math.random().toString(36).slice(2),
    body: "Hello",
    createdAt: "2026-08-28T09:04:00Z",
    fromClient: false,
    authorName: "Jace",
    channel: "external",
    ...over,
  };
}

describe("dayLabel", () => {
  it("uses words for the two days that matter", () => {
    // A thread whose last heading reads "Today" says at a glance that this
    // is live; one reading a date from March says it is not.
    expect(dayLabel("2026-08-28", NOW)).toBe("Today");
    expect(dayLabel("2026-08-27", NOW)).toBe("Yesterday");
  });

  it("uses the date for anything older", () => {
    expect(dayLabel("2026-08-20", NOW)).toBe("Aug 20, 2026");
  });

  it("reads back the day it was given, not the one before", () => {
    // A bare date parsed in a negative timezone is the previous day.
    expect(dayLabel("2026-01-01", NOW)).toBe("Jan 1, 2026");
  });
});

describe("groupByDay", () => {
  it("splits a thread into days", () => {
    const days = groupByDay(
      [
        msg({ createdAt: "2026-08-27T09:04:00Z" }),
        msg({ createdAt: "2026-08-28T10:08:00Z" }),
        msg({ createdAt: "2026-08-28T11:00:00Z" }),
      ],
      NOW
    );
    expect(days.map((d) => d.label)).toEqual(["Yesterday", "Today"]);
    expect(days[1].messages).toHaveLength(2);
  });

  it("runs oldest first, which is the order it happened", () => {
    const days = groupByDay(
      [msg({ createdAt: "2026-08-28T11:00:00Z", body: "second" }),
       msg({ createdAt: "2026-08-28T09:00:00Z", body: "first" })],
      NOW
    );
    expect(days[0].messages.map((m) => m.body)).toEqual(["first", "second"]);
  });

  it("still shows a message whose timestamp cannot be read", () => {
    // Silently vanishing from a conversation somebody relies on is worse
    // than an odd heading.
    const days = groupByDay([msg({ createdAt: "nonsense", body: "orphan" })], NOW);
    expect(days[0].label).toBe("Undated");
    expect(days[0].messages[0].body).toBe("orphan");
  });

  it("puts the undated ones out of the way at the top", () => {
    const days = groupByDay(
      [msg({ createdAt: "nonsense" }), msg({ createdAt: "2026-08-28T09:00:00Z" })],
      NOW
    );
    expect(days[0].label).toBe("Undated");
  });

  it("is empty for an empty thread", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});

describe("messageTime", () => {
  it("is a clock time", () => {
    expect(messageTime("2026-08-28T09:04:00Z")).toMatch(/^\d{1,2}:\d{2}/);
  });

  it("says nothing for a timestamp it cannot read", () => {
    expect(messageTime("nope")).toBe("");
  });
});

describe("channelLabel", () => {
  it("distinguishes a team note from a message to the client", () => {
    expect(channelLabel("internal")).toBe("Team note");
    expect(channelLabel("external")).toBe("Message");
  });
});

describe("reachLine", () => {
  it("says plainly when only the team sees it", () => {
    expect(reachLine({ channel: "internal", phone: "410", email: "a@b.com", smsReady: true }))
      .toBe("Only the team sees this.");
  });

  it("names every way a client message actually reaches them", () => {
    // "Message the client" means a text to one business and an email to
    // another, and somebody typing should know which before they press send.
    const line = reachLine({ channel: "external", phone: "410 555 0123", email: "jo@x.com", smsReady: true });
    expect(line).toContain("text 410 555 0123");
    expect(line).toContain("email jo@x.com");
  });

  it("does not promise a text when texting is not switched on", () => {
    const line = reachLine({ channel: "external", phone: "410 555 0123", email: null, smsReady: false });
    expect(line).not.toContain("text");
    expect(line).toContain("proposal page");
  });

  it("admits when there is no way to reach them but the page", () => {
    const line = reachLine({ channel: "external", phone: null, email: null, smsReady: true });
    expect(line).toContain("no phone or email on file");
  });

  it("uses no dashes", () => {
    expect(reachLine({ channel: "external", phone: "1", email: "a@b", smsReady: true }))
      .not.toMatch(/[—–]/);
  });
});

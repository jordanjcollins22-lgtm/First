import { describe, expect, it } from "vitest";

import {
  applyNo,
  buildBoard,
  canSend,
  deriveCard,
  groupByPerson,
  noWhy,
  oneInValidate,
  replyChannel,
  replyCheck,
  type BoardMessage,
  type CardState,
} from "@/lib/comms-board";

const msg = (over: Partial<BoardMessage> & { id: string; at: string }): BoardMessage => ({
  channel: "sms",
  direction: "in",
  text: "hi",
  ...over,
});

describe("one card per person, across channels", () => {
  it("joins a text, an email and a form from the same customer", () => {
    const people = groupByPerson([
      msg({ id: "1", at: "2026-11-01T10:00:00Z", customerId: "c1", phone: "(410) 555-0142", name: "Dana" }),
      msg({ id: "2", at: "2026-11-02T10:00:00Z", channel: "email", email: "DANA@example.com", customerId: "c1" }),
      msg({ id: "3", at: "2026-11-03T10:00:00Z", channel: "form", customerId: "c1" }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].key).toBe("c:c1");
    expect(people[0].messages.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("joins by phone number in any format, and through a shared email", () => {
    const people = groupByPerson([
      msg({ id: "1", at: "2026-11-01T10:00:00Z", phone: "+1 410-555-0177" }),
      msg({ id: "2", at: "2026-11-02T10:00:00Z", phone: "4105550177", email: "lou@example.com" }),
      msg({ id: "3", at: "2026-11-03T10:00:00Z", channel: "email", email: "Lou@Example.com" }),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].messages).toHaveLength(3);
  });

  it("keeps different people apart, newest conversation first", () => {
    const people = groupByPerson([
      msg({ id: "1", at: "2026-11-01T10:00:00Z", phone: "4105550101" }),
      msg({ id: "2", at: "2026-11-05T10:00:00Z", channel: "ig_dm", handle: "ig:99" }),
    ]);
    expect(people.map((p) => p.key)).toEqual(["h:ig:99", "p:4105550101"]);
  });
});

describe("already replied, and double texts", () => {
  const theirs = msg({ id: "1", at: "2026-11-01T10:00:00Z" });
  const ours = msg({ id: "2", at: "2026-11-01T11:00:00Z", direction: "out" });

  it("knows when nothing is owed", () => {
    expect(replyCheck([theirs]).alreadyReplied).toBe(false);
    expect(replyCheck([theirs, ours]).alreadyReplied).toBe(true);
    expect(replyCheck([theirs, ours]).ourStreak).toBe(1);
  });

  it("reads every message since our last reply", () => {
    const later = [msg({ id: "3", at: "2026-11-02T10:00:00Z" }), msg({ id: "4", at: "2026-11-02T10:05:00Z", channel: "email" })];
    expect(replyCheck([theirs, ours, ...later]).unread.map((m) => m.id)).toEqual(["3", "4"]);
  });

  it("refuses to send after somebody else replied, or after they wrote again", () => {
    expect(canSend([theirs, ours], theirs.at)).toEqual({ ok: false, reason: "already_replied" });
    const again = msg({ id: "5", at: "2026-11-01T10:30:00Z" });
    expect(canSend([theirs, again], theirs.at)).toEqual({ ok: false, reason: "new_message" });
    expect(canSend([theirs], theirs.at)).toEqual({ ok: true });
  });
});

describe("lanes", () => {
  const person = (messages: BoardMessage[]) => groupByPerson(messages)[0];
  const first = msg({ id: "1", at: "2026-11-01T10:00:00Z", customerId: "c1" });

  it("puts a new message in Backlog and an answered one in Track", () => {
    expect(deriveCard(person([first]), null).lane).toBe("backlog");
    expect(deriveCard(person([first, msg({ id: "2", at: "2026-11-01T12:00:00Z", direction: "out", customerId: "c1" })]), null).lane).toBe("track");
  });

  it("cancels a pending draft when they write again, back to Breakdown", () => {
    const state: CardState = { personKey: "c:c1", lane: "doing", draft: "Hi Dana", intent: "question", basedOn: first.at };
    const card = deriveCard(person([first, msg({ id: "2", at: "2026-11-01T10:10:00Z", customerId: "c1" })]), state);
    expect(card.lane).toBe("breakdown");
    expect(card.restarted).toBe(true);
    expect(card.draft).toBeNull();
    expect(card.intent).toBeNull();
  });

  it("cancels in Validate too, and a question waiting in Track", () => {
    const again = person([first, msg({ id: "2", at: "2026-11-02T00:00:00Z", customerId: "c1" })]);
    expect(deriveCard(again, { personKey: "c:c1", lane: "validate", draft: "x", basedOn: first.at }).lane).toBe("breakdown");
    expect(deriveCard(again, { personKey: "c:c1", lane: "track", question: { text: "?", options: [] }, basedOn: first.at }).lane).toBe("breakdown");
  });

  it("moves a card answered from the inbox to Track rather than double texting", () => {
    const replied = person([first, msg({ id: "2", at: "2026-11-01T11:00:00Z", direction: "out", customerId: "c1" })]);
    const card = deriveCard(replied, { personKey: "c:c1", lane: "doing", draft: "Hi", basedOn: first.at });
    expect(card.lane).toBe("track");
    expect(card.repliedElsewhere).toBe(true);
  });

  it("brings a sent card back to Backlog when they write again", () => {
    const p = person([first, msg({ id: "2", at: "2026-11-03T10:00:00Z", customerId: "c1" })]);
    const sent: CardState = { personKey: "c:c1", lane: "done", sent: { body: "Hi", channel: "sms", at: "2026-11-02T10:00:00Z", byHand: false } };
    expect(deriveCard(p, sent).lane).toBe("backlog");
  });
});

describe("Validate · Doing holds one card", () => {
  it("keeps the first, and the rest wait ready in Answer · Doing", () => {
    const people = groupByPerson([
      msg({ id: "1", at: "2026-11-01T10:00:00Z", customerId: "a" }),
      msg({ id: "2", at: "2026-11-01T10:00:00Z", customerId: "b" }),
      msg({ id: "3", at: "2026-11-01T10:00:00Z", customerId: "c" }),
    ]);
    const states: CardState[] = [
      { personKey: "c:a", lane: "doing", draft: "a", basedOn: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T12:00:00Z" },
      { personKey: "c:b", lane: "validate", draft: "b", basedOn: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T13:00:00Z" },
      { personKey: "c:c", lane: "validate", draft: "c", basedOn: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T14:00:00Z" },
    ];
    const board = buildBoard(people, states);
    expect(board.filter((c) => c.lane === "validate").map((c) => c.personKey)).toEqual(["c:b"]);
    expect(board.find((c) => c.personKey === "c:c")?.ready).toBe(true);
    expect(board.find((c) => c.personKey === "c:a")?.ready).toBe(true);
  });

  it("moves the oldest ready card up when Validate is empty", () => {
    const people = groupByPerson([msg({ id: "1", at: "2026-11-01T10:00:00Z", customerId: "a" }), msg({ id: "2", at: "2026-11-01T10:00:00Z", customerId: "b" })]);
    const cards = people.map((p, i) => ({ ...deriveCard(p, { personKey: p.key, lane: "doing", draft: "x", basedOn: "2026-11-01T10:00:00Z", updatedAt: `2026-11-0${2 + i}T00:00:00Z` }) }));
    const out = oneInValidate(cards);
    expect(out.filter((c) => c.lane === "validate")).toHaveLength(1);
    expect(out.find((c) => c.lane === "validate")?.updatedAt).toBe("2026-11-02T00:00:00Z");
  });
});

describe("No requires a why", () => {
  it("refuses an empty No and joins taps and typing", () => {
    expect(noWhy([], "  ")).toEqual({ error: "Say why, so Claude can fix it." });
    expect(noWhy(["Wrong price"], "")).toEqual({ why: "Wrong price" });
    expect(noWhy(["Wrong tone"], "too formal")).toEqual({ why: "Wrong tone. too formal" });
  });

  it("sends the card back to Answer · Doing with every why kept", () => {
    const next = applyNo({ personKey: "k", lane: "validate", draft: "x", noReasons: [{ why: "a", at: "t0" }] }, "b", "t1");
    expect(next.lane).toBe("doing");
    expect(next.draft).toBeNull();
    expect(next.noReasons?.map((n) => n.why)).toEqual(["a", "b"]);
  });
});

describe("where a reply goes", () => {
  it("answers on the channel they used when the app can send there", () => {
    expect(replyChannel({ messages: [msg({ id: "1", at: "t", channel: "ig_dm" })], phones: [], emails: [], jobIds: [] })).toEqual({ channel: "ig_dm", byHand: false });
    expect(replyChannel({ messages: [msg({ id: "1", at: "t", channel: "email" })], phones: [], emails: ["a@example.com"], jobIds: ["j"] })).toEqual({ channel: "email", byHand: false });
  });

  it("texts back a call when there is a job and a number, else by hand", () => {
    expect(replyChannel({ messages: [msg({ id: "1", at: "t", channel: "call" })], phones: ["4105550101"], emails: [], jobIds: ["j"] })).toEqual({ channel: "sms", byHand: false });
    expect(replyChannel({ messages: [msg({ id: "1", at: "t", channel: "nextdoor" })], phones: [], emails: [], jobIds: [] })).toEqual({ channel: "nextdoor", byHand: true });
  });
});

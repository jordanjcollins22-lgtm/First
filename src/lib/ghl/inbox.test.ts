import { describe, expect, it } from "vitest";

import {
  captureHealth,
  channelName,
  conversationsToOpen,
  inboundFromMessages,
  parseConversation,
  parseWebhook,
} from "@/lib/ghl/inbox";

const NOW = new Date("2026-11-26T13:05:00.000Z");

describe("parseWebhook", () => {
  it("reads a Customer Replied workflow webhook", () => {
    const m = parseWebhook(
      {
        contact_id: "c1",
        full_name: "Roger Johnson",
        phone: "+14435284180",
        message: { body: "That will work, thank you", type: 2, id: "m1" },
      },
      NOW
    );
    expect(m).toMatchObject({
      ghlMessageId: "m1",
      contactId: "c1",
      name: "Roger Johnson",
      phone: "+14435284180",
      channel: "SMS",
      body: "That will work, thank you",
    });
  });

  it("reads a marketplace InboundMessage event", () => {
    const m = parseWebhook({
      type: "InboundMessage",
      messageId: "m2",
      conversationId: "v2",
      contactId: "c2",
      body: "Do you do snow?",
      messageType: "Email",
      dateAdded: "2026-11-26T13:00:00.000Z",
    });
    expect(m).toMatchObject({ ghlMessageId: "m2", conversationId: "v2", channel: "Email", receivedAt: "2026-11-26T13:00:00.000Z" });
  });

  it("ignores our own outbound messages and empty steps", () => {
    expect(parseWebhook({ direction: "outbound", body: "Hi" })).toBeNull();
    expect(parseWebhook({ type: "OutboundMessage", body: "Hi" })).toBeNull();
    expect(parseWebhook({ contact_id: "c1" })).toBeNull();
    expect(parseWebhook("nonsense")).toBeNull();
  });
});

describe("channelName", () => {
  it("names GoHighLevel's message types", () => {
    expect(channelName("TYPE_SMS")).toBe("SMS");
    expect(channelName(2)).toBe("SMS");
    expect(channelName("TYPE_EMAIL")).toBe("Email");
    expect(channelName("TYPE_FACEBOOK")).toBe("FB");
    expect(channelName("TYPE_INSTAGRAM")).toBe("IG");
    expect(channelName("TYPE_LIVE_CHAT")).toBe("Live_Chat");
    expect(channelName(undefined)).toBe("SMS");
  });
});

describe("the sweep", () => {
  const conversation = parseConversation({
    id: "rnyCFsHL0tZE9jEpv7Lt",
    lastMessageDate: Date.parse("2026-11-26T13:01:35.872Z"),
    contactId: "HFr9daNZCjPwBRiOqsYX",
    fullName: "Roger Johnson",
    phone: "+14435284180",
    lastMessageDirection: "inbound",
  })!;

  it("opens only conversations active since the cutoff", () => {
    const old = parseConversation({ id: "old", lastMessageDate: Date.parse("2026-11-20T00:00:00Z") })!;
    const since = new Date("2026-11-26T12:50:00Z");
    expect(conversationsToOpen([conversation, old], since).map((c) => c.id)).toEqual(["rnyCFsHL0tZE9jEpv7Lt"]);
  });

  it("keeps inbound messages newer than the cutoff, from GoHighLevel's nested list", () => {
    const payload = {
      messages: {
        lastMessageId: "out1",
        messages: [
          { id: "in1", direction: "inbound", body: "Happy Thanksgiving, that works", messageType: "TYPE_SMS", from: "+14435284180", dateAdded: "2026-11-26T13:01:35.872Z" },
          { id: "out1", direction: "outbound", body: "Hi Roger", messageType: "TYPE_SMS", dateAdded: "2026-11-26T13:00:33.357Z" },
          { id: "photo", direction: "inbound", body: "", attachments: ["a.jpg"], messageType: "TYPE_SMS", dateAdded: "2026-11-26T13:02:00Z" },
          { id: "act", direction: "inbound", body: "Stage changed", messageType: "TYPE_ACTIVITY_OPPORTUNITY", dateAdded: "2026-11-26T13:02:00Z" },
          { id: "old", direction: "inbound", body: "Earlier", messageType: "TYPE_SMS", dateAdded: "2026-11-25T13:00:00Z" },
        ],
      },
    };
    const found = inboundFromMessages(payload, conversation, new Date("2026-11-26T12:50:00Z"));
    expect(found.map((m) => m.ghlMessageId)).toEqual(["in1", "photo"]);
    expect(found[0]).toMatchObject({ conversationId: "rnyCFsHL0tZE9jEpv7Lt", contactId: "HFr9daNZCjPwBRiOqsYX", name: "Roger Johnson", channel: "SMS" });
    expect(found[1].body).toBe("(sent a photo or file)");
  });
});

describe("captureHealth", () => {
  it("is fine after a clean run", () => {
    expect(captureHealth({ lastOkAt: NOW.toISOString(), failuresInARow: 0 }, NOW).ok).toBe(true);
  });
  it("speaks up after three failures in a row", () => {
    expect(captureHealth({ lastOkAt: NOW.toISOString(), failuresInARow: 3 }, NOW).ok).toBe(false);
  });
  it("speaks up when nothing has finished in over ten minutes", () => {
    const h = captureHealth({ lastOkAt: "2026-11-26T12:40:00.000Z", failuresInARow: 1 }, NOW);
    expect(h.ok).toBe(false);
    expect(h.reason).toMatch(/25 minutes/);
  });
});

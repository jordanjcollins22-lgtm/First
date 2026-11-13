import { describe, expect, it } from "vitest";

import { normalizeChannel, parseInboundMessage, parseInboundSms } from "./inbound";

describe("parseInboundSms", () => {
  it("parses a workflow 'Customer Replied' webhook", () => {
    const parsed = parseInboundSms({
      contact_id: "c_123",
      full_name: "Marcus Lee",
      phone: "+15551234567",
      message: { type: 2, body: "On site, running 20 min behind" },
      location: { id: "loc_1" },
    });
    expect(parsed).toEqual({
      contactId: "c_123",
      phone: "+15551234567",
      body: "On site, running 20 min behind",
      messageId: null,
    });
  });

  it("parses a marketplace InboundMessage event", () => {
    const parsed = parseInboundSms({
      type: "InboundMessage",
      locationId: "loc_1",
      contactId: "c_9",
      messageId: "m_1",
      body: "Done with front beds",
      messageType: "SMS",
      direction: "inbound",
    });
    expect(parsed).toMatchObject({ contactId: "c_9", body: "Done with front beds", messageId: "m_1" });
  });

  it("ignores outbound echoes, other event types and empty bodies", () => {
    expect(parseInboundSms({ type: "OutboundMessage", body: "hi" })).toBeNull();
    expect(parseInboundSms({ direction: "outbound", body: "hi", contactId: "c" })).toBeNull();
    expect(parseInboundSms({ contact_id: "c", message: { body: "   " } })).toBeNull();
    expect(parseInboundSms(null)).toBeNull();
  });
});

describe("parseInboundMessage", () => {
  it("reads the channel from custom data first", () => {
    const parsed = parseInboundMessage({
      contact_id: "c_1",
      full_name: "Dana Ruiz",
      email: "dana@example.com",
      phone: "+15550001111",
      message: { type: 2, body: "Do you do boats?" },
      customData: { channel: "TYPE_INSTAGRAM" },
    });
    expect(parsed).toMatchObject({
      channel: "instagram",
      contactId: "c_1",
      name: "Dana Ruiz",
      email: "dana@example.com",
      body: "Do you do boats?",
    });
  });

  it("uses messageType on marketplace events", () => {
    expect(
      parseInboundMessage({ type: "InboundMessage", contactId: "c", body: "hi", messageType: "Email" })?.channel
    ).toBe("email");
  });

  it("falls back to sms when there's a phone and no type", () => {
    expect(parseInboundMessage({ contact_id: "c", phone: "+15550001111", message: { body: "yo" } })?.channel).toBe("sms");
  });
});

describe("normalizeChannel", () => {
  it.each([
    ["SMS", "sms"],
    ["TYPE_SMS", "sms"],
    ["2", "sms"],
    ["3", "email"],
    ["TYPE_EMAIL", "email"],
    ["FB", "facebook"],
    ["TYPE_FACEBOOK", "facebook"],
    ["IG", "instagram"],
    ["WhatsApp", "whatsapp"],
    ["GMB", "gmb"],
    ["Live_Chat", "live_chat"],
    ["TYPE_WEBCHAT", "live_chat"],
  ])("%s -> %s", (raw, expected) => {
    expect(normalizeChannel(raw)).toBe(expected);
  });

  it("returns null for unknown types", () => {
    expect(normalizeChannel("TYPE_CALL")).toBeNull();
    expect(normalizeChannel(null)).toBeNull();
  });
});

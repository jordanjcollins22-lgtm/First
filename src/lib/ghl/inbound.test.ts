import { describe, expect, it } from "vitest";

import { parseInboundSms } from "./inbound";

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

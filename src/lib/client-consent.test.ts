import { describe, expect, it } from "vitest";

import {
  consentVerdict,
  helpReply,
  inboundIntent,
  startConfirmation,
  stopConfirmation,
  type ConsentInput,
} from "@/lib/client-consent";

function input(over: Partial<ConsentInput> = {}): ConsentInput {
  return {
    basis: "service",
    channel: "sms",
    state: "unknown",
    doNotContact: false,
    providerReady: true,
    address: "+15551234567",
    ...over,
  };
}

describe("whether we may write to a client", () => {
  it("texts a client about work in hand without needing a tick box", () => {
    // They gave us the number so we could tell them about the work. Nobody
    // ever presented a client with a consent form and nobody had to.
    expect(consentVerdict(input())).toEqual({ send: true });
  });

  it("will not send marketing to somebody who never said yes", () => {
    const verdict = consentVerdict(input({ basis: "marketing" }));
    expect(verdict.send).toBe(false);
    expect(verdict.send === false && verdict.reason).toBe("no_consent");
  });

  it("sends marketing once somebody has said yes", () => {
    expect(consentVerdict(input({ basis: "marketing", state: "granted" }))).toEqual({ send: true });
  });

  it("stops means stop, even for a reminder we would otherwise be entitled to send", () => {
    // A client who texts STOP and gets an appointment reminder anyway has
    // been ignored, which is worse than a missed reminder.
    const verdict = consentVerdict(input({ state: "revoked", basis: "service" }));
    expect(verdict.send).toBe(false);
    expect(verdict.send === false && verdict.reason).toBe("revoked");
  });

  it("puts stop above do not contact, so the reason given is the one they gave", () => {
    const verdict = consentVerdict(input({ state: "revoked", doNotContact: true }));
    expect(verdict.send === false && verdict.reason).toBe("revoked");
  });

  it("respects the do not contact flag", () => {
    const verdict = consentVerdict(input({ doNotContact: true }));
    expect(verdict.send === false && verdict.reason).toBe("do_not_contact");
  });

  it("says which key is missing when the provider is not set up", () => {
    const sms = consentVerdict(input({ providerReady: false }));
    expect(sms.send === false && sms.detail).toContain("Twilio");
    const email = consentVerdict(input({ providerReady: false, channel: "email" }));
    expect(email.send === false && email.detail).toContain("Resend");
  });

  it("cannot send to nobody", () => {
    for (const address of [null, undefined, "", "   "]) {
      const verdict = consentVerdict(input({ address }));
      expect(verdict.send === false && verdict.reason).toBe("no_address");
    }
  });
});

describe("what a client texting back is asking for", () => {
  it("reads the words carriers require to work", () => {
    expect(inboundIntent("STOP")).toBe("stop");
    expect(inboundIntent("HELP")).toBe("help");
    expect(inboundIntent("START")).toBe("start");
  });

  it("reads them however they were typed", () => {
    expect(inboundIntent("  stop. ")).toBe("stop");
    expect(inboundIntent("Stop!")).toBe("stop");
    expect(inboundIntent("UNSUBSCRIBE")).toBe("stop");
    expect(inboundIntent("Cancel")).toBe("stop");
  });

  it("reads a keyword somebody wrote with a space in it", () => {
    expect(inboundIntent("stop all")).toBe("stop");
    expect(inboundIntent("opt out")).toBe("stop");
    expect(inboundIntent("opt in")).toBe("start");
  });

  it("does not mistake a sentence for an opt-out", () => {
    // Treating this as STOP loses a client every text they wanted.
    expect(inboundIntent("Stop by tomorrow if you can")).toBe("message");
    expect(inboundIntent("can you cancel thursday please")).toBe("message");
    expect(inboundIntent("help me move the gate")).toBe("message");
  });

  it("treats anything else as a message", () => {
    expect(inboundIntent("Sounds good, see you then")).toBe("message");
    expect(inboundIntent("")).toBe("message");
    expect(inboundIntent("   ")).toBe("message");
  });
});

describe("what we say back", () => {
  it("confirms an opt-out and says how to undo it", () => {
    const reply = stopConfirmation("JS Landscaping");
    expect(reply).toContain("JS Landscaping");
    expect(reply).toContain("START");
  });

  it("answers HELP with what we send and how to stop", () => {
    const reply = helpReply("JS Landscaping", "410 555 0100");
    expect(reply).toContain("410 555 0100");
    expect(reply).toContain("STOP");
    expect(reply.toLowerCase()).toContain("rates may apply");
  });

  it("answers HELP without a number when there is not one", () => {
    expect(helpReply("JS Landscaping", null)).toContain("STOP");
  });

  it("confirms an opt-in", () => {
    expect(startConfirmation("JS Landscaping")).toContain("STOP");
  });
});

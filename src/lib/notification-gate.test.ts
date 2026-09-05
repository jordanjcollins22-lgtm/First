import { describe, expect, it } from "vitest";
import { DEFAULTS, effectivePrefs, notificationGate } from "./notification-gate";
import { toE164 } from "./sms";

const gate = (over: Partial<Parameters<typeof notificationGate>[0]> = {}) =>
  notificationGate({
    smsConfigured: true,
    prefs: null,
    phone: "4105550123",
    toE164,
    kind: "client_messages",
    ...over,
  });

describe("notificationGate", () => {
  it("says plainly when there is no text provider", () => {
    // The reason nothing has ever sent. It used to be a bare return false.
    const verdict = gate({ smsConfigured: false });
    expect(verdict.send).toBe(false);
    if (!verdict.send) {
      expect(verdict.reason).toBe("no_sms_provider");
      expect(verdict.detail).toMatch(/TWILIO_ACCOUNT_SID/);
    }
  });

  it("notifies somebody who has never opened the settings", () => {
    // The bug. The stored default for the master switch is false and nobody
    // had a row at all, so every team member was silent forever and nothing
    // anywhere said why.
    expect(gate({ prefs: null }).send).toBe(true);
  });

  it("respects a preference somebody actually saved", () => {
    const verdict = gate({ prefs: { sms_enabled: false }, hasStoredPrefs: true });
    expect(verdict.send).toBe(false);
    if (!verdict.send) expect(verdict.reason).toBe("muted");
  });

  it("keeps teammate chatter off until it is asked for", () => {
    // The one that becomes noise, and the one people turn off first.
    expect(gate({ kind: "team_messages" }).send).toBe(false);
    expect(gate({ kind: "team_messages", prefs: { team_messages: true } }).send).toBe(true);
  });

  it("still sends a kind somebody opted into specifically", () => {
    expect(gate({ kind: "team_messages", overridesKind: true }).send).toBe(true);
  });

  it("does not let an opt-in override a mute or a missing number", () => {
    // "Do not text me" and "there is nowhere to text" are not overridable by
    // wanting it.
    expect(gate({ prefs: { sms_enabled: false }, overridesKind: true }).send).toBe(false);
    expect(gate({ phone: null, overridesKind: true }).send).toBe(false);
  });

  it("names a missing phone number as the reason", () => {
    const verdict = gate({ phone: "" });
    expect(verdict.send).toBe(false);
    if (!verdict.send) expect(verdict.reason).toBe("no_phone");
  });

  it("names a number it cannot dial, and quotes it back", () => {
    // Seven of ten profiles have no number and the rest may be typed how a
    // person types them. "555-1234" is not dialable and saying so beats
    // silence.
    const verdict = gate({ phone: "555-1234" });
    expect(verdict.send).toBe(false);
    if (!verdict.send) {
      expect(verdict.reason).toBe("unreadable_phone");
      expect(verdict.detail).toContain("555-1234");
    }
  });

  it("accepts the ways a real number gets typed", () => {
    for (const phone of ["4105550123", "(410) 555-0123", "+14105550123", "1-410-555-0123"]) {
      expect(gate({ phone }).send, phone).toBe(true);
    }
  });
});

describe("effectivePrefs", () => {
  it("gives the defaults to somebody with no row", () => {
    expect(effectivePrefs(null)).toEqual(DEFAULTS);
  });

  it("keeps every value somebody saved, including the falses", () => {
    // A saved false is a decision. Filling it in from a default would undo it.
    const saved = effectivePrefs({ sms_enabled: false, client_messages: false });
    expect(saved.sms_enabled).toBe(false);
    expect(saved.client_messages).toBe(false);
  });

  it("fills in only what a partial row leaves unsaid", () => {
    const partial = effectivePrefs({ team_messages: true });
    expect(partial.team_messages).toBe(true);
    expect(partial.client_messages).toBe(DEFAULTS.client_messages);
  });
});

import { describe, expect, it } from "vitest";

import {
  clientValidityLine,
  daysLeft,
  DEFAULT_VALID_DAYS,
  expiredWording,
  expiryOf,
  isExpired,
  isValidDays,
  validityLine,
} from "./proposal-validity";

const now = new Date("2026-09-19T12:00:00Z");

describe("validity", () => {
  it("offers seven or fourteen days, fourteen by default", () => {
    expect(isValidDays(7)).toBe(true);
    expect(isValidDays(14)).toBe(true);
    expect(isValidDays(10)).toBe(false);
    expect(DEFAULT_VALID_DAYS).toBe(14);
  });

  it("runs from the day it was sent", () => {
    expect(expiryOf("2026-09-10T22:56:52Z", 7).toISOString()).toBe("2026-09-17T22:56:52.000Z");
    expect(expiryOf("2026-08-31T14:51:55Z", 14).toISOString()).toBe("2026-09-14T14:51:55.000Z");
  });

  it("counts days left and knows when it is over", () => {
    expect(daysLeft("2026-09-24T22:56:52Z", now)).toBe(6);
    expect(isExpired("2026-09-14T14:51:55Z", now)).toBe(true);
    expect(isExpired("2026-09-24T22:56:52Z", now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });

  it("words it for the office", () => {
    expect(validityLine("2026-09-24T22:56:52Z", now)).toBe("6 days left, until Sep 24");
    expect(validityLine("2026-09-20T11:00:00Z", now)).toBe("Expires tomorrow");
    expect(validityLine("2026-09-14T14:51:55Z", now)).toBe("Expired Sep 14");
    expect(validityLine(null, now)).toBeNull();
  });

  it("words it for the client, and goes quiet once it is over", () => {
    expect(clientValidityLine("2026-09-24T22:56:52Z", now)).toBe("This price is good for 6 more days, until Sep 24.");
    expect(clientValidityLine("2026-09-14T14:51:55Z", now)).toBeNull();
    const gone = expiredWording("2026-09-14T14:51:55Z");
    expect(gone.headline).toBe("This proposal expired on Sep 14.");
    expect(gone.detail).toMatch(/fresh one/);
  });

  it("uses no dashes", () => {
    for (const line of [validityLine("2026-09-24T22:56:52Z", now), clientValidityLine("2026-09-24T22:56:52Z", now), expiredWording(now).detail]) {
      expect(line).not.toMatch(/[—–]/);
    }
  });
});

import { describe, expect, it } from "vitest";

import { formatPhoneForDisplay, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("handles common US formats", () => {
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("555.123.4567")).toBe("+15551234567");
    expect(normalizePhone("1-555-123-4567")).toBe("+15551234567");
    expect(normalizePhone("+1 555 123 4567")).toBe("+15551234567");
  });

  it("keeps international numbers that already have a +", () => {
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("rejects junk", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("formatPhoneForDisplay", () => {
  it("pretty-prints US numbers and passes others through", () => {
    expect(formatPhoneForDisplay("+15551234567")).toBe("(555) 123-4567");
    expect(formatPhoneForDisplay("+442079460958")).toBe("+442079460958");
  });
});

import { describe, expect, it } from "vitest";

import {
  readRemembered,
  rememberBooking,
  REMEMBER_DAYS,
  summarise,
  type RememberedBooking,
} from "@/lib/booking-memory";

const NOW = new Date("2026-09-10T12:00:00.000Z");

const DETAILS = {
  firstName: "Jordan",
  lastName: "Collins",
  email: "jordan@example.com",
  phone: "+1 443 504 8162",
  address: "3100 Trellis Lane, Abingdon, MD 21009",
  lat: 39.4665,
  lng: -76.2983,
};

function stored(over: Record<string, unknown> = {}, at: Date = NOW): string {
  return JSON.stringify({ ...DETAILS, savedAt: at.toISOString(), ...over });
}

describe("remembering somebody between bookings", () => {
  it("gives back exactly what was put in", () => {
    const back = readRemembered(stored(), NOW);
    expect(back).toMatchObject(DETAILS);
  });

  it("keeps details for months, because a garden is a yearly thought", () => {
    const old = new Date(NOW.getTime() - (REMEMBER_DAYS - 1) * 86_400_000);
    expect(readRemembered(stored({}, old), NOW)).not.toBeNull();
  });

  it("forgets details older than that rather than offering a stale address", () => {
    const ancient = new Date(NOW.getTime() - (REMEMBER_DAYS + 1) * 86_400_000);
    expect(readRemembered(stored({}, ancient), NOW)).toBeNull();
  });

  it("forgets details saved in the future, which means a wrong clock", () => {
    const ahead = new Date(NOW.getTime() + 5 * 86_400_000);
    expect(readRemembered(stored({}, ahead), NOW)).toBeNull();
  });

  it("is nothing when the browser has nothing", () => {
    expect(readRemembered(null, NOW)).toBeNull();
    expect(readRemembered("", NOW)).toBeNull();
  });

  it("is nothing rather than a crash when the blob is rubbish", () => {
    expect(readRemembered("{not json", NOW)).toBeNull();
    expect(readRemembered("null", NOW)).toBeNull();
    expect(readRemembered('"a string"', NOW)).toBeNull();
  });

  it("refuses a half-filled record rather than offering half a form", () => {
    for (const missing of ["firstName", "lastName", "email", "phone", "address"]) {
      expect(readRemembered(stored({ [missing]: "" }), NOW), missing).toBeNull();
    }
  });

  it("refuses a record with no usable pin, since the times depend on it", () => {
    expect(readRemembered(stored({ lat: "somewhere" }), NOW)).toBeNull();
    expect(readRemembered(stored({ lng: null }), NOW)).toBeNull();
    // Number(null) is 0, and 0,0 is a spot in the Atlantic. A record with a
    // missing pin must not come back looking usable.
    expect(readRemembered(stored({ lat: 0, lng: 0 }), NOW)).toBeNull();
  });

  it("trims what somebody typed with a trailing space", () => {
    expect(readRemembered(stored({ firstName: "  Jordan  " }), NOW)?.firstName).toBe("Jordan");
  });
});

describe("deciding there is something worth keeping", () => {
  it("keeps a complete booking, stamped with the time", () => {
    const raw = rememberBooking(DETAILS, NOW);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).savedAt).toBe(NOW.toISOString());
  });

  it("survives the round trip", () => {
    expect(readRemembered(rememberBooking(DETAILS, NOW), NOW)).toMatchObject(DETAILS);
  });

  it("keeps nothing when there is nothing to keep", () => {
    expect(rememberBooking({ ...DETAILS, email: "  " }, NOW)).toBeNull();
    expect(rememberBooking({ ...DETAILS, address: "" }, NOW)).toBeNull();
  });
});

describe("describing somebody back to themselves", () => {
  const remembered: RememberedBooking = { ...DETAILS, savedAt: NOW.toISOString() };

  it("leads with the name and the address, which is what they recognise", () => {
    const summary = summarise(remembered);
    expect(summary.name).toBe("Jordan Collins");
    expect(summary.address).toBe(DETAILS.address);
  });

  it("shows only the last four of the phone number", () => {
    // Enough to recognise, not enough to be worth reading over a shoulder.
    const summary = summarise(remembered);
    expect(summary.contact).toContain("8162");
    expect(summary.contact).not.toContain("443 504");
  });

  it("copes with a phone number too short to abbreviate", () => {
    expect(summarise({ ...remembered, phone: "12" }).contact).toContain("12");
  });
});

import { describe, expect, it } from "vitest";

import {
  CLIENT_SIDE_TYPES,
  CONTACT_TYPES,
  TRADE_TYPES,
  contactTypeLabel,
  isClientSide,
  isContactType,
  isTrade,
} from "@/lib/contact-types";

describe("isClientSide", () => {
  it("counts clients and leads", () => {
    // Somebody who rang last spring and never booked is still a record we
    // want when picking who a job is for.
    expect(isClientSide("client")).toBe(true);
    expect(isClientSide("lead")).toBe(true);
  });

  it("keeps the trade out of client lists", () => {
    for (const type of TRADE_TYPES) {
      expect(isClientSide(type)).toBe(false);
    }
  });

  it("keeps an unsorted row out until somebody decides", () => {
    // A supplier appearing in a client picker costs more than having to sort.
    expect(isClientSide("other")).toBe(false);
  });

  it("treats a row with no type as a client", () => {
    // Everything predating this was created by somebody booking work, and
    // defaulting to unsorted would empty every client list on migration day.
    expect(isClientSide(null)).toBe(true);
    expect(isClientSide(undefined)).toBe(true);
  });
});

describe("isTrade", () => {
  it("groups the people we work with rather than for", () => {
    expect(isTrade("supplier")).toBe(true);
    expect(isTrade("subcontractor")).toBe(true);
    expect(isTrade("referral_partner")).toBe(true);
  });

  it("does not sweep clients in", () => {
    expect(isTrade("client")).toBe(false);
    expect(isTrade(null)).toBe(false);
  });
});

describe("the two groups do not overlap", () => {
  it("puts every type on exactly one side, or deliberately neither", () => {
    const overlap = CLIENT_SIDE_TYPES.filter((t) => TRADE_TYPES.includes(t));
    expect(overlap).toEqual([]);
    // "other" is on neither side on purpose.
    const covered = new Set([...CLIENT_SIDE_TYPES, ...TRADE_TYPES]);
    expect(CONTACT_TYPES.filter((t) => !covered.has(t.value)).map((t) => t.value)).toEqual(["other"]);
  });
});

describe("labels", () => {
  it("names every type", () => {
    for (const type of CONTACT_TYPES) {
      expect(contactTypeLabel(type.value)).toBe(type.label);
    }
  });

  it("falls back rather than printing a raw value", () => {
    expect(contactTypeLabel("something_else")).toBe("Unsorted");
  });

  it("recognises only the types it defines", () => {
    expect(isContactType("client")).toBe(true);
    expect(isContactType("plumber")).toBe(false);
  });
});

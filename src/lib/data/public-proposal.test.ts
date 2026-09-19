import { describe, expect, it } from "vitest";
import { needsServiceNames } from "./public-proposal";

describe("needsServiceNames", () => {
  it("asks for names when a snapshot still holds a raw id", () => {
    // These are the old proposals the repair exists for. Skipping the lookup
    // on one of these would put a database id in front of a client.
    expect(
      needsServiceNames([
        { zoneName: "Front", serviceLabel: "custom-488c16d9-2617-46ea-8635-cb7ce7bd8448" },
      ])
    ).toBe(true);
  });

  it("spots a raw id on any zone, not just the first", () => {
    expect(
      needsServiceNames([
        { zoneName: "Front", serviceLabel: "Mulching" },
        { zoneName: "Back", serviceLabel: "custom-488c16d9-2617-46ea-8635-cb7ce7bd8448" },
      ])
    ).toBe(true);
  });

  it("skips the lookup when every label is already a name", () => {
    // The normal case, and the whole point: a round trip whose answer would
    // have been thrown away, on the one page a client is waiting on.
    expect(
      needsServiceNames([
        { zoneName: "Front", serviceLabel: "Mulching" },
        { zoneName: "Back", serviceLabel: "Lawn Renovation" },
      ])
    ).toBe(false);
  });

  it("does not go looking when there is no snapshot to read", () => {
    expect(needsServiceNames([])).toBe(false);
    expect(needsServiceNames(null)).toBe(false);
    expect(needsServiceNames(undefined)).toBe(false);
    expect(needsServiceNames("not an array")).toBe(false);
  });

  it("survives a zone with nothing on it", () => {
    // A snapshot is stored JSON, so it is whatever was written years ago.
    expect(needsServiceNames([null, {}, { serviceLabel: 42 }])).toBe(false);
  });
});

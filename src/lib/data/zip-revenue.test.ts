import { describe, expect, it } from "vitest";

import { isFamily, pickRange, zipOf } from "./zip-revenue";

describe("zipOf", () => {
  it("reads the ZIP at the end of an address", () => {
    expect(zipOf("2900 Lomond Place, Abingdon, Maryland 21009, United States")).toBe("21009");
    expect(zipOf("12 Main St, Bel Air, MD 21014-1234")).toBe("21014");
  });
  it("doesn't take a house number for a ZIP", () => {
    expect(zipOf("21015 Old Joppa Rd, Joppa, MD 21085")).toBe("21085");
    expect(zipOf("21015 Old Joppa Rd")).toBeNull();
    expect(zipOf(null)).toBeNull();
  });
});

describe("pickRange", () => {
  const now = new Date("2026-11-17T15:00:00Z");
  it("defaults to this month", () => {
    expect(pickRange({}, now)).toMatchObject({ key: "month", from: "2026-11-01", to: "2026-11-17" });
  });
  it("covers the last 90 days including today", () => {
    expect(pickRange({ range: "90d" }, now)).toMatchObject({ from: "2026-08-20", to: "2026-11-17" });
  });
  it("takes custom dates, swapped if backwards, and ignores junk", () => {
    expect(pickRange({ range: "custom", from: "2026-10-31", to: "2026-10-01" }, now)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(pickRange({ range: "custom", from: "nope" }, now)).toMatchObject({ from: "2026-11-01", to: "2026-11-17" });
  });
});

it("knows the family", () => {
  expect(isFamily("Linda Heffner")).toBe(true);
  expect(isFamily("Jane Smith")).toBe(false);
});

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { readPhotoTaps, tapsFor } from "./crew-job";

describe("photo taps", () => {
  const zones = [
    { service: { photoMarkers: { "a.jpg": [{ x: 0.6, y: 0.48 }], "b.jpg": [{ x: 0.4, y: 0.5 }, { x: 2, y: 0.5 }] } } },
    { service: null },
    { service: { photoMarkers: { "c.jpg": "junk" } } },
  ];

  it("reads every tap off the site plan, keyed by photo", () => {
    const taps = readPhotoTaps(zones);
    expect(taps.get("a.jpg")).toEqual([{ x: 0.6, y: 0.48 }]);
    expect(taps.get("b.jpg")).toEqual([{ x: 0.4, y: 0.5 }]);
    expect(taps.has("c.jpg")).toBe(false);
  });

  it("gives a zone the taps for its own photos", () => {
    expect(tapsFor(["a.jpg", "z.jpg"], readPhotoTaps(zones))).toEqual({ "a.jpg": [{ x: 0.6, y: 0.48 }] });
  });

  it("copes with no site plan", () => {
    expect(readPhotoTaps(null).size).toBe(0);
  });
});

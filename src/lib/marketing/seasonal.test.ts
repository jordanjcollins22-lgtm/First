import { describe, expect, it } from "vitest";

import { autoStartAllowed, excludedBecause, inWindow, openSeasons, seasonAudience, seasonalDedupeKey, seasonalEmail, type PastClient } from "./seasonal";

const client = (over: Partial<PastClient> = {}): PastClient => ({
  customerId: "c1",
  name: "Kara Thompson",
  email: "kara@example.com",
  completedJobs: 1,
  services: ["lawn mowing"],
  hasSnowThisSeason: false,
  doNotContact: false,
  ...over,
});

describe("seasonal windows", () => {
  it("knows which seasons are open", () => {
    expect(openSeasons(new Date("2026-10-13T15:00:00Z"))).toEqual(["snow_presell"]);
    expect(openSeasons(new Date("2026-09-10T15:00:00Z"))).toEqual(["aeration", "snow_presell"]);
    expect(openSeasons(new Date("2027-02-01T15:00:00Z"))).toEqual(["spring_cleanup"]);
    expect(inWindow("snow_presell", new Date("2026-12-01T15:00:00Z"))).toBe(false);
  });
});

describe("audience", () => {
  it("is past clients with an email who haven't asked to be left alone", () => {
    expect(excludedBecause("spring_cleanup", client())).toBeNull();
    expect(excludedBecause("spring_cleanup", client({ doNotContact: true }))).toMatch(/not to be contacted/);
    expect(excludedBecause("spring_cleanup", client({ email: null }))).toBe("no email");
    expect(excludedBecause("spring_cleanup", client({ completedJobs: 0 }))).toMatch(/no finished job/);
  });

  it("cross-sells: aeration to lawn clients without it, snow to those not on snow", () => {
    expect(excludedBecause("aeration", client())).toBeNull();
    expect(excludedBecause("aeration", client({ services: ["core aeration"] }))).toMatch(/already/);
    expect(excludedBecause("aeration", client({ services: ["mulch install"] }))).toMatch(/no lawn work/);
    expect(excludedBecause("snow_presell", client({ hasSnowThisSeason: true }))).toMatch(/already on snow/);
    expect(seasonAudience("snow_presell", [client(), client({ customerId: "c2", services: ["salting"] })])).toHaveLength(1);
  });

  it("writes one plain email with the booking link, keyed once per season per year", () => {
    const e = seasonalEmail("snow_presell", client(), { name: "JS Landscaping", phone: "443-819-1521" }, "https://app/book");
    expect(e.body).toMatch(/^Hi Kara,/);
    expect(e.body).toContain("https://app/book");
    expect(e.body).toContain("443-819-1521");
    expect(seasonalDedupeKey("snow_presell", 2026, "c1")).toBe("seasonal:snow_presell:2026:c1");
  });
});

describe("go-live guard", () => {
  const now = new Date("2026-10-13T15:00:00Z");
  it("starts on its own only when automatic, on, past go-live and in season", () => {
    expect(autoStartAllowed({ enabled: true, mode: "auto", goLive: "2026-10-01", season: "snow_presell", now })).toBe(true);
    expect(autoStartAllowed({ enabled: true, mode: "auto", goLive: null, season: "snow_presell", now })).toBe(false);
    expect(autoStartAllowed({ enabled: true, mode: "auto", goLive: "2026-10-20", season: "snow_presell", now })).toBe(false);
    expect(autoStartAllowed({ enabled: true, mode: "owner", goLive: "2026-10-01", season: "snow_presell", now })).toBe(false);
    expect(autoStartAllowed({ enabled: false, mode: "auto", goLive: "2026-10-01", season: "snow_presell", now })).toBe(false);
    expect(autoStartAllowed({ enabled: true, mode: "auto", goLive: "2026-10-01", season: "aeration", now })).toBe(false);
  });
});

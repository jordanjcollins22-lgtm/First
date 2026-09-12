import { describe, expect, it } from "vitest";

import { modeForAddress, modeLabel, NEARBY_MILES } from "@/lib/evaluation-mode";

const BEL_AIR = { lat: 39.5359, lng: -76.3483 };
const ABINGDON = { lat: 39.4665, lng: -76.2983 };
const TOWSON = { lat: 39.4015, lng: -76.6019 };
const PHILADELPHIA = { lat: 39.9526, lng: -75.1652 };
const DENVER = { lat: 39.7392, lng: -104.9903 };

describe("who we drive to", () => {
  it("goes out to Harford County", () => {
    expect(modeForAddress(BEL_AIR.lat, BEL_AIR.lng).mode).toBe("in_person");
    expect(modeForAddress(ABINGDON.lat, ABINGDON.lng).mode).toBe("in_person");
  });

  it("goes out to the county next door, because a job is a job", () => {
    // Towson is Baltimore County, and comfortably worth the drive.
    expect(modeForAddress(TOWSON.lat, TOWSON.lng).mode).toBe("in_person");
  });

  it("does the far ones over a screen rather than turning them away", () => {
    expect(modeForAddress(PHILADELPHIA.lat, PHILADELPHIA.lng).mode).toBe("digital");
    expect(modeForAddress(DENVER.lat, DENVER.lng).mode).toBe("digital");
  });

  it("drives to an address it cannot place", () => {
    // One wasted drive is cheaper than telling somebody in Bel Air they are
    // too far away.
    expect(modeForAddress(null, null).mode).toBe("in_person");
    expect(modeForAddress(Number.NaN, -76.3).mode).toBe("in_person");
  });
});

describe("what each side is told", () => {
  it("tells the office the distance it decided on", () => {
    expect(modeForAddress(PHILADELPHIA.lat, PHILADELPHIA.lng).why).toMatch(/miles from Bel Air/);
    expect(modeForAddress(BEL_AIR.lat, BEL_AIR.lng).why).toContain("Harford");
  });

  it("tells the client what will happen, without apologising for it", () => {
    const far = modeForAddress(PHILADELPHIA.lat, PHILADELPHIA.lng).says;
    expect(far).toContain("video walkthrough");
    expect(far).toContain("Same evaluator");
    expect(far).not.toMatch(/sorry|unfortunately|afraid/i);
  });

  it("says somebody is coming when somebody is coming", () => {
    expect(modeForAddress(BEL_AIR.lat, BEL_AIR.lng).says).toContain("come out to you");
  });

  it("has a short name for each, for the office's own screens", () => {
    expect(modeLabel("digital")).toBe("Video walkthrough");
    expect(modeLabel("in_person")).toBe("On site");
  });
});

describe("where the line falls", () => {
  it("is a real number rather than a feeling", () => {
    expect(NEARBY_MILES).toBeGreaterThan(10);
    expect(NEARBY_MILES).toBeLessThan(60);
  });

  it("switches over somewhere between the two, and only once", () => {
    // Walk due east from Bel Air and the answer must change exactly once.
    const modes = Array.from({ length: 40 }, (_, i) =>
      modeForAddress(BEL_AIR.lat, BEL_AIR.lng + i * 0.08).mode
    );
    const flips = modes.filter((m, i) => i > 0 && m !== modes[i - 1]).length;
    expect(flips).toBe(1);
    expect(modes[0]).toBe("in_person");
    expect(modes[modes.length - 1]).toBe("digital");
  });
});

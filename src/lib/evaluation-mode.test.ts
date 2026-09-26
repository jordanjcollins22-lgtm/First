import { describe, expect, it } from "vitest";

import { modeForAddress, modeLabel } from "@/lib/evaluation-mode";

const BEL_AIR = { lat: 39.5359, lng: -76.3483 };
const ABINGDON = { lat: 39.4665, lng: -76.2983 };
const TOWSON = { lat: 39.4015, lng: -76.6019 };
const PERRY_HALL = { lat: 39.4126, lng: -76.4636 };
const PHILADELPHIA = { lat: 39.9526, lng: -75.1652 };
const DENVER = { lat: 39.7392, lng: -104.9903 };

describe("who we drive to", () => {
  it("goes out to Harford County", () => {
    expect(modeForAddress(BEL_AIR.lat, BEL_AIR.lng).mode).toBe("in_person");
    expect(modeForAddress(ABINGDON.lat, ABINGDON.lng).mode).toBe("in_person");
  });

  it("does everywhere outside the county over a screen, even next door", () => {
    expect(modeForAddress(TOWSON.lat, TOWSON.lng).mode).toBe("digital");
    expect(modeForAddress(PERRY_HALL.lat, PERRY_HALL.lng).mode).toBe("digital");
    expect(modeForAddress(PHILADELPHIA.lat, PHILADELPHIA.lng).mode).toBe("digital");
    expect(modeForAddress(DENVER.lat, DENVER.lng).mode).toBe("digital");
  });

  it("reads the address when there is no pin", () => {
    expect(modeForAddress(null, null, "12 Main St, Bel Air, MD 21014").mode).toBe("in_person");
    expect(modeForAddress(Number.NaN, -76.3, "5 Oak Rd, Towson, MD 21204").mode).toBe("digital");
    expect(modeForAddress(null, null, null).mode).toBe("digital");
  });
});

describe("what each side is told", () => {
  it("tells the office why", () => {
    expect(modeForAddress(PHILADELPHIA.lat, PHILADELPHIA.lng).why).toContain("Outside Harford");
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

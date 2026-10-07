import { describe, expect, it } from "vitest";

import { askFor, measurementRequestEmail, unmeasuredZones, type MeasurableZone } from "./measurement-request";

function zone(over: Partial<MeasurableZone>): MeasurableZone {
  return { name: "Zone 1", serviceLabel: "Landscape Cleanup", basis: "flat", measurementKind: "none", areaSqFt: null, perimeterFt: null, ...over };
}

describe("unmeasuredZones", () => {
  it("lists areas with a service and no size", () => {
    const out = unmeasuredZones([zone({}), zone({ name: "Zone 2", areaSqFt: 400 }), zone({ name: "Zone 3", serviceLabel: null })]);
    expect(out.map((z) => z.name)).toEqual(["Zone 1"]);
  });
  it("counts length and width as measured, and a run by its length", () => {
    expect(unmeasuredZones([zone({ lengthFt: 20, widthFt: 10 })])).toEqual([]);
    expect(unmeasuredZones([zone({ measurementKind: "linear", lengthFt: 40 })])).toEqual([]);
    expect(unmeasuredZones([zone({ measurementKind: "linear" })])).toHaveLength(1);
  });
  it("asks a count-priced service only for its quantity", () => {
    expect(unmeasuredZones([zone({ basis: "count", quantity: 1 })])).toEqual([]);
    expect(unmeasuredZones([zone({ basis: "count", quantity: null })])).toHaveLength(1);
  });
});

describe("askFor", () => {
  it("asks in the terms the service is priced in", () => {
    expect(askFor(zone({ basis: "area" }))).toBe("length × width in feet");
    expect(askFor(zone({ basis: "perimeter" }))).toBe("length in feet");
    expect(askFor(zone({ basis: "count" }))).toBe("how many");
    expect(askFor(zone({ basis: "flat" }))).toContain("how long");
  });
});

describe("measurementRequestEmail", () => {
  it("names the client, the address and each area", () => {
    const email = measurementRequestEmail({
      evaluatorName: "Jace",
      clientName: "Jonathan Mazzone",
      address: "415 Harrington Road, Bel Air, Maryland 21015, United States",
      zones: [zone({}), zone({ name: "Zone 4", serviceLabel: "Plant / Bush Removal" })],
      jobLink: "https://app.example/jobs/1",
      businessName: "JS Landscaping MD",
    });
    expect(email.subject).toBe("Measurements needed: 415 Harrington Road, Bel Air (Jonathan Mazzone)");
    expect(email.text).toContain("Hi Jace,");
    expect(email.text).toContain("2 areas on the site map have no measurements");
    expect(email.text).toContain("• Zone 1 – Landscape Cleanup: length × width in feet, and roughly how long it will take");
    expect(email.text).toContain("• Zone 4 – Plant / Bush Removal");
    expect(email.text).toContain("https://app.example/jobs/1");
  });
});

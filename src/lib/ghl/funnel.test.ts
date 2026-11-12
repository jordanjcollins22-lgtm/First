import { describe, expect, it } from "vitest";
import { funnelField, funnelOf } from "./funnel";

describe("GoHighLevel funnel field", () => {
  const fields = [
    { id: "a", name: "Gate code" },
    { id: "b", name: "Lead Source - Type" },
    { id: "c", name: "How did you hear about us?" },
  ];

  it("finds the funnel field, a named one first", () => {
    expect(funnelField(fields)?.id).toBe("c");
    expect(funnelField(fields, "lead source - type")?.id).toBe("b");
    expect(funnelField([{ id: "x", name: "Gate code" }])).toBeNull();
  });

  it("reads the funnel off a contact, falling back to ad attribution, never the automatic source", () => {
    expect(funnelOf({ customFields: [{ id: "c", value: " Spring  mulch funnel " }] }, "c")).toBe("Spring mulch funnel");
    expect(funnelOf({ customFields: [], attributionSource: { utmSource: "facebook" } }, "c")).toBe("facebook");
    expect(funnelOf({ source: "JS Landscaping app" }, "c")).toBeNull();
    expect(funnelOf({}, "c")).toBeNull();
    expect(funnelOf(null, "c")).toBeNull();
  });
});

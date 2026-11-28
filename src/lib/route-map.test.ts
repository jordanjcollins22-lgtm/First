import { describe, expect, it } from "vitest";
import { encodePolyline, routeMapUrl } from "./route-map";

describe("encodePolyline", () => {
  it("matches Google's documented example", () => {
    expect(encodePolyline([[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]])).toBe("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
  });
});

describe("routeMapUrl", () => {
  it("draws a line and numbered pins per crew", () => {
    const url = routeMapUrl([{ color: "#0f766e", stops: [{ lat: 39.5, lng: -76.3 }, { lat: 39.6, lng: -76.2 }] }], "tok")!;
    expect(url).toContain("path-5+0f766e-0.85(");
    expect(url).toContain("pin-l-1+0f766e(-76.30000,39.50000)");
    expect(url).toContain("pin-l-2+0f766e(-76.20000,39.60000)");
    expect(url).toContain("access_token=tok");
  });
  it("gives nothing without a token or pins", () => {
    expect(routeMapUrl([], "tok")).toBeNull();
    expect(routeMapUrl([{ color: "#000", stops: [{ lat: 1, lng: 1 }] }], "")).toBeNull();
  });
});

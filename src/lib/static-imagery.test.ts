import { describe, expect, it } from "vitest";

import { mapboxStaticUrl, parseStaticPath, pinPosition, planTiles, worldPixel } from "@/lib/static-imagery";

describe("parseStaticPath", () => {
  it("reads pins, the centre and the size like a Mapbox static URL", () => {
    const req = parseStaticPath("pin-s+2f6d3c(-76.36514,39.51987)/-76.36514,39.51987,19,0/480x320@2x");
    expect(req).toMatchObject({ lng: -76.36514, lat: 39.51987, zoom: 19, bearing: 0, width: 480, height: 320, scale: 2 });
    expect(req?.pins).toEqual([{ size: "s", label: null, color: "2f6d3c", lng: -76.36514, lat: 39.51987 }]);
  });

  it("reads several pins, numbered ones and none at all", () => {
    expect(parseStaticPath("pin-s+3b82f6(-76.1,39.5),pin-s+ff3b30(-76.2,39.6)/-76.2,39.6,20,0/1024x1024")?.pins).toHaveLength(2);
    expect(parseStaticPath("pin-l-3+2f6d3c(-76.1,39.5)/-76.1,39.5,19/600x400@2x")?.pins[0]).toMatchObject({ size: "l", label: "3" });
    expect(parseStaticPath("-76.1,39.5,19.25,135.5/1280x1280@2x")).toMatchObject({ pins: [], zoom: 19.25, bearing: 135.5, scale: 2 });
  });

  it("ignores the query string", () => {
    expect(parseStaticPath("-76.1,39.5,19,0/600x400@2x?attribution=false&logo=false")).not.toBeNull();
  });

  it("refuses what it doesn't draw, or anything out of range", () => {
    expect(parseStaticPath("auto/600x400")).toBeNull();
    expect(parseStaticPath("path-5+f44(abc)/-76.1,39.5,19/600x400")).toBeNull();
    expect(parseStaticPath("-76.1,39.5,19/2000x400")).toBeNull();
    expect(parseStaticPath("-200,39.5,19/600x400")).toBeNull();
    expect(parseStaticPath("-76.1,39.5,30/600x400")).toBeNull();
    expect(parseStaticPath("../../etc/passwd")).toBeNull();
  });
});

describe("planTiles", () => {
  it("matches Mapbox's ground: zoom 19 at @2x is level 21 of a 256-pixel scheme", () => {
    const plan = planTiles(parseStaticPath("-76.36514,39.51987,19,0/480x320@2x")!, 21);
    expect(plan.level).toBe(21);
    expect(plan.ratio).toBe(1);
    expect(plan.outWidth).toBe(960);
    expect(plan.regionWidth).toBe(962);
  });

  it("enlarges past the source's last level rather than inventing detail", () => {
    const plan = planTiles(parseStaticPath("-76.36514,39.51987,20,0/600x400@2x")!, 21);
    expect(plan.level).toBe(21);
    expect(plan.ratio).toBe(0.5);
  });

  it("covers the whole fetched area with tiles", () => {
    const plan = planTiles(parseStaticPath("-76.36514,39.51987,19,0/480x320@2x")!, 21);
    const xs = plan.tiles.map((t) => t.dx);
    const ys = plan.tiles.map((t) => t.dy);
    expect(Math.min(...xs)).toBeLessThanOrEqual(0);
    expect(Math.max(...xs) + 256).toBeGreaterThanOrEqual(plan.regionWidth);
    expect(Math.min(...ys)).toBeLessThanOrEqual(0);
    expect(Math.max(...ys) + 256).toBeGreaterThanOrEqual(plan.regionHeight);
  });

  it("fetches the square a turned picture's corners sweep", () => {
    const plan = planTiles(parseStaticPath("-76.36514,39.51987,19,45/600x400@2x")!, 21);
    expect(plan.regionWidth).toBe(plan.regionHeight);
    expect(plan.regionWidth).toBeGreaterThanOrEqual(Math.ceil(Math.hypot(1200, 800)));
  });
});

describe("pinPosition", () => {
  it("puts the centre's pin in the middle", () => {
    const req = parseStaticPath("pin-s+fff(-76.36514,39.51987)/-76.36514,39.51987,19,0/480x320@2x")!;
    expect(pinPosition(req, planTiles(req, 21), req.pins[0])).toEqual([480, 320]);
  });

  it("turns with the map: east of centre is up when the bearing is 90", () => {
    const req = parseStaticPath("-76.36514,39.51987,19,90/400x400@2x")!;
    const plan = planTiles(req, 21);
    const [x, y] = pinPosition(req, plan, { lng: -76.3651, lat: 39.51987 });
    expect(x).toBeCloseTo(400, 0);
    expect(y).toBeLessThan(400);
  });
});

describe("worldPixel", () => {
  it("is the standard tile scheme", () => {
    const [x, y] = worldPixel(0, 0, 0);
    expect(x).toBeCloseTo(128);
    expect(y).toBeCloseTo(128);
  });
});

describe("mapboxStaticUrl", () => {
  it("rebuilds the Mapbox URL with the token, without the credits", () => {
    expect(mapboxStaticUrl("-76.1,39.5,19,0/600x400@2x?x=1", "pk.abc")).toBe(
      "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/-76.1,39.5,19,0/600x400@2x?attribution=false&logo=false&access_token=pk.abc"
    );
  });
});

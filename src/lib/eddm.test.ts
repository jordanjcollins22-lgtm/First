import { describe, expect, it } from "vitest";
import * as turf from "@turf/turf";

import {
  eddmError,
  eddmRoutesUrl,
  featuresIn,
  mercatorToLngLat,
  outerRing,
  parseEddmRoutes,
  routeBoundary,
  routesToFeatures,
  routesToStreetFeatures,
} from "@/lib/eddm";

/** A small grid of streets, the way USPS actually answers: short polylines. */
function streets(): [number, number][][] {
  const paths: [number, number][][] = [];
  for (let i = 0; i <= 4; i++) {
    const lng = -76.36 + i * 0.005;
    paths.push([[lng, 39.53], [lng, 39.5325]], [[lng, 39.5325], [lng, 39.535]]);
    const lat = 39.53 + i * 0.00125;
    paths.push([[-76.36, lat], [-76.35, lat], [-76.34, lat]]);
  }
  return paths;
}

/** The shape the EDDM map's geoprocessing task answered with for 21014, trimmed. */
const GP_RESPONSE = {
  results: [
    {
      paramName: "Output_Feature_Class",
      dataType: "GPFeatureRecordSetLayer",
      value: {
        geometryType: "esriGeometryPolyline",
        spatialReference: { wkid: 4326 },
        features: [
          {
            attributes: {
              OBJECTID: 1,
              ZIP_CRID: "21014C002",
              ZIP_CODE: "21014",
              CRID_ID: "C002",
              BUS_CNT: 82,
              RES_CNT: 538,
              TOT_CNT: 620,
              MED_INCOME: 106625,
              MED_AGE: 65,
              AVG_HH_SIZ: 2.54,
              LT_200_IND: "N",
            },
            geometry: { paths: streets() },
          },
          { attributes: { ZIP_CODE: "21014", CRID_ID: "C013" }, geometry: { paths: [] } },
        ],
      },
    },
  ],
};

describe("eddmRoutesUrl", () => {
  it("puts the ZIP into the request the EDDM map makes", () => {
    const url = eddmRoutesUrl("21014-1234");
    expect(url).toContain("Zip=21014");
    expect(url).toContain("outSR=4326");
    expect(url).toContain("/EDDM/selectZIP/GPServer/routes/execute");
  });
});

describe("routeBoundary", () => {
  it("draws a boundary around the streets that takes in the houses beside them", () => {
    const rings = routeBoundary(streets());
    expect(rings.length).toBeGreaterThan(0);
    const polygon = turf.polygon([[...rings[0], rings[0][0]]]);
    // The middle of the grid, and a house forty metres past the last street.
    expect(turf.booleanPointInPolygon([-76.35, 39.5325], polygon)).toBe(true);
    expect(turf.booleanPointInPolygon([-76.3395, 39.5325], polygon)).toBe(true);
    // Not the next neighbourhood over.
    expect(turf.booleanPointInPolygon([-76.33, 39.5325], polygon)).toBe(false);
  });

  it("is nothing for too few points", () => {
    expect(routeBoundary([[[-76.36, 39.53], [-76.35, 39.53]]])).toEqual([]);
  });
});

describe("parseEddmRoutes", () => {
  it("reads routes drawn as streets, counts and all, and works out a boundary", () => {
    const routes = parseEddmRoutes(GP_RESPONSE, "21014");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ zip: "21014", routeId: "C002", residential: 538, business: 82, total: 620 });
    expect(routes[0].paths.length).toBe(streets().length);
    expect(routes[0].rings[0].length).toBeGreaterThan(3);
  });

  it("still reads a route given as a boundary, and converts metres to degrees", () => {
    const routes = parseEddmRoutes(
      {
        features: [
          {
            attributes: { ZIP: "21014", ROUTE: "R001", RESIDENTIAL: "300" },
            geometry: { rings: [[[-8498000, 4791000], [-8497000, 4791000], [-8497000, 4792000], [-8498000, 4791000]]] },
          },
        ],
      },
      "21014"
    );
    expect(routes[0].routeId).toBe("R001");
    expect(routes[0].residential).toBe(300);
    expect(routes[0].rings[0][0][0]).toBeCloseTo(-76.34, 1);
  });

  it("leaves out a route with nothing to draw", () => {
    expect(parseEddmRoutes(GP_RESPONSE, "21014").map((r) => r.routeId)).not.toContain("C013");
  });

  it("finds nothing in an error or in nonsense, and names the error", () => {
    expect(parseEddmRoutes({ error: { message: "Invalid ZIP" } }, "x")).toEqual([]);
    expect(eddmError({ error: { code: 400, message: "Invalid ZIP", details: ["Zip is required"] } })).toBe("Invalid ZIP Zip is required");
    expect(eddmError("<html>")).toMatch(/not JSON/);
    expect(featuresIn(null)).toEqual([]);
  });
});

describe("features", () => {
  it("converts Web Mercator to longitude and latitude", () => {
    const [lng, lat] = mercatorToLngLat(-8498000, 4791000);
    expect(lng).toBeCloseTo(-76.34, 1);
    expect(lat).toBeCloseTo(39.53, 1);
  });

  it("draws each route as a boundary with USPS's figures on it, and its streets to match", () => {
    const [route] = parseEddmRoutes(GP_RESPONSE, "21014");
    const [feature] = routesToFeatures([route]);
    expect(feature.geometry.type).toBe("Polygon");
    expect(feature.properties).toMatchObject({
      zip: "21014",
      routeId: "C002",
      total: 620,
      medianIncome: 106625,
      medianAge: 65,
      householdSize: 2.54,
      under200: false,
    });
    expect(outerRing(route)).toBe(route.rings[0]);
    const [street] = routesToStreetFeatures([route]);
    expect(street.geometry.type).toBe("MultiLineString");
    expect(street.properties.color).toBe(feature.properties.color);
  });
});

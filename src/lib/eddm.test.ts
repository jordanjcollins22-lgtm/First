import { describe, expect, it } from "vitest";

import { eddmError, eddmRoutesUrl, featuresIn, mercatorToLngLat, outerRing, parseEddmRoutes, routesToFeatures } from "@/lib/eddm";

/** The shape the EDDM map's geoprocessing task answers with, as observed. */
const GP_RESPONSE = {
  results: [
    {
      paramName: "ZIP5Routes",
      dataType: "GPFeatureRecordSetLayer",
      value: {
        geometryType: "esriGeometryPolygon",
        spatialReference: { wkid: 4326 },
        features: [
          {
            attributes: { ZIP_CODE: "21014", CRID_ID: "C012", RES_CNT: 412, BUS_CNT: 9, TOT_CNT: 421, AVG_INCOME: 98000 },
            geometry: {
              rings: [
                [
                  [-76.36, 39.53],
                  [-76.33, 39.53],
                  [-76.33, 39.545],
                  [-76.36, 39.545],
                  [-76.36, 39.53],
                ],
              ],
            },
          },
          { attributes: { ZIP_CODE: "21014", CRID_ID: "C013" }, geometry: { rings: [] } },
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

describe("parseEddmRoutes", () => {
  it("reads routes out of a geoprocessing answer, counts and all", () => {
    const routes = parseEddmRoutes(GP_RESPONSE, "21014");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ zip: "21014", routeId: "C012", residential: 412, business: 9, total: 421 });
    expect(routes[0].rings[0]).toHaveLength(5);
    expect(routes[0].attributes.AVG_INCOME).toBe(98000);
  });

  it("reads a plain feature set too, and converts metres to degrees when USPS ignores the projection", () => {
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
    const [lng, lat] = routes[0].rings[0][0];
    expect(lng).toBeCloseTo(-76.34, 1);
    expect(lat).toBeCloseTo(39.53, 1);
  });

  it("leaves out a route with no boundary", () => {
    expect(parseEddmRoutes(GP_RESPONSE, "21014").map((r) => r.routeId)).not.toContain("C013");
  });

  it("finds nothing in an error or in nonsense, and names the error", () => {
    expect(parseEddmRoutes({ error: { message: "Invalid ZIP" } }, "x")).toEqual([]);
    expect(eddmError({ error: { code: 400, message: "Invalid ZIP", details: ["Zip is required"] } })).toBe("Invalid ZIP Zip is required");
    expect(eddmError("<html>")).toMatch(/not JSON/);
    expect(featuresIn(null)).toEqual([]);
  });
});

describe("geometry", () => {
  it("converts Web Mercator to longitude and latitude", () => {
    const [lng, lat] = mercatorToLngLat(-8498000, 4791000);
    expect(lng).toBeCloseTo(-76.34, 1);
    expect(lat).toBeCloseTo(39.53, 1);
  });

  it("draws each route as a polygon with the biggest ring outside", () => {
    const [route] = parseEddmRoutes(GP_RESPONSE, "21014");
    const [feature] = routesToFeatures([route]);
    expect(feature.geometry.type).toBe("Polygon");
    expect(feature.properties).toMatchObject({ zip: "21014", routeId: "C012", total: 421 });
    expect(outerRing(route)).toBe(route.rings[0]);
  });
});

import { describe, expect, it } from "vitest";

import {
  centroidOf,
  cleanEndpoint,
  describeEndpoint,
  layerUrl,
  metadataUrl,
  parseCount,
  parseFeaturePage,
  pickAddressLayer,
  queryUrl,
  sqlLiteral,
  zipWhere,
} from "@/lib/arcgis";

describe("describeEndpoint", () => {
  it("recognises a layer by its fields, and reads the paging limits off it", () => {
    const described = describeEndpoint({
      name: "Address Master",
      geometryType: "esriGeometryPoint",
      maxRecordCount: 2000,
      advancedQueryCapabilities: { supportsPagination: true },
      fields: [
        { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
        { name: "FULLADDR", type: "esriFieldTypeString", alias: "Full Address" },
      ],
    });
    expect(described.kind).toBe("layer");
    expect(described.layerName).toBe("Address Master");
    expect(described.fields.map((f) => f.name)).toEqual(["OBJECTID", "FULLADDR"]);
    expect(described.maxRecordCount).toBe(2000);
    expect(described.supportsPagination).toBe(true);
  });

  it("recognises a service by its layers", () => {
    const described = describeEndpoint({
      mapName: "Cadastral",
      layers: [
        { id: 0, name: "Parcels", type: "Feature Layer" },
        { id: 1, name: "Address Points", type: "Feature Layer" },
      ],
    });
    expect(described.kind).toBe("service");
    expect(described.layers).toHaveLength(2);
  });

  it("recognises the catalog at the root", () => {
    const described = describeEndpoint({
      folders: ["Planning", "PublicSafety"],
      services: [{ name: "Planning/Cadastral", type: "MapServer" }],
    });
    expect(described.kind).toBe("catalog");
    expect(described.services).toEqual(["Planning/Cadastral/MapServer"]);
    expect(described.folders).toEqual(["Planning", "PublicSafety"]);
  });

  it("surfaces the error a server hides inside a 200", () => {
    // ArcGIS answers a missing layer with HTTP 200 and an error object.
    // Reading that as "a layer with no fields" would be a silent failure.
    const described = describeEndpoint({ error: { code: 400, message: "Invalid URL" } });
    expect(described.kind).toBe("unknown");
    expect(described.error).toBe("400: Invalid URL");
  });

  it("is unknown rather than wrong for a body that is not ArcGIS", () => {
    expect(describeEndpoint("<html>").kind).toBe("unknown");
    expect(describeEndpoint(null).kind).toBe("unknown");
    expect(describeEndpoint({ hello: "world" }).kind).toBe("unknown");
  });
});

describe("urls", () => {
  it("builds the smallest metadata request", () => {
    expect(metadataUrl("https://gis.example.gov/arcgis/rest/services/Cadastral/MapServer/3/")).toBe(
      "https://gis.example.gov/arcgis/rest/services/Cadastral/MapServer/3?f=json"
    );
  });

  it("strips whatever query a pasted URL carried", () => {
    expect(cleanEndpoint("https://gis.example.gov/x/MapServer/3?f=pjson ")).toBe(
      "https://gis.example.gov/x/MapServer/3"
    );
    expect(layerUrl("https://gis.example.gov/x/MapServer/", 3)).toBe("https://gis.example.gov/x/MapServer/3");
  });

  it("pages in WGS84, ordered, from an offset", () => {
    const url = new URL(
      queryUrl("https://gis.example.gov/x/MapServer/3", { where: "ZIP LIKE '21014%'", offset: 2000, pageSize: 500 })
    );
    expect(url.pathname).toBe("/x/MapServer/3/query");
    expect(url.searchParams.get("where")).toBe("ZIP LIKE '21014%'");
    expect(url.searchParams.get("outSR")).toBe("4326");
    expect(url.searchParams.get("resultOffset")).toBe("2000");
    expect(url.searchParams.get("resultRecordCount")).toBe("500");
    expect(url.searchParams.get("orderByFields")).toBe("OBJECTID");
    expect(url.searchParams.get("outFields")).toBe("*");
    expect(url.searchParams.get("returnGeometry")).toBe("true");
  });

  it("asks only for a count when that is all that is wanted", () => {
    const url = new URL(
      queryUrl("https://gis.example.gov/x/MapServer/3", { where: "1=1", offset: 0, pageSize: 1, countOnly: true })
    );
    expect(url.searchParams.get("returnCountOnly")).toBe("true");
    expect(url.searchParams.has("resultOffset")).toBe(false);
  });

  it("escapes a quote in a literal", () => {
    expect(sqlLiteral("O'Neill")).toBe("'O''Neill'");
  });

  it("filters by the ZIP field when there is one, and by the address when there is not", () => {
    expect(zipWhere("21014", "ZIPCODE", "FULLADDR")).toBe("ZIPCODE LIKE '21014%'");
    expect(zipWhere("21014-1234", null, "FULLADDR")).toBe("FULLADDR LIKE '%21014%'");
  });
});

describe("pickAddressLayer", () => {
  it("prefers the address layer to the parcel layer", () => {
    // A parcel is a lot; an address is a door. A lot with four townhouses on
    // it is four addresses, which is what door hangers count.
    const picked = pickAddressLayer([
      { id: 0, name: "Parcels", type: "Feature Layer" },
      { id: 4, name: "Address Master", type: "Feature Layer" },
    ]);
    expect(picked?.id).toBe(4);
  });

  it("falls back to parcels, and never to a group layer", () => {
    expect(pickAddressLayer([{ id: 2, name: "Tax Parcels", type: "Feature Layer" }])?.id).toBe(2);
    expect(pickAddressLayer([{ id: 0, name: "Addresses", type: "Group Layer" }])).toBeNull();
  });
});

describe("features", () => {
  it("takes a point as it is", () => {
    expect(centroidOf({ x: -76.3483, y: 39.5359 })).toEqual({ lat: 39.5359, lng: -76.3483 });
  });

  it("averages a polygon's outer ring", () => {
    const centre = centroidOf({
      rings: [
        [
          [-76.35, 39.53],
          [-76.34, 39.53],
          [-76.34, 39.54],
          [-76.35, 39.54],
          [-76.35, 39.53],
        ],
      ],
    });
    expect(centre?.lat).toBeCloseTo(39.534, 3);
    expect(centre?.lng).toBeCloseTo(-76.346, 3);
  });

  it("refuses a coordinate that is not one", () => {
    // State Plane feet, when a server ignores outSR. Better no pin than a
    // pin in the Indian Ocean.
    expect(centroidOf({ x: 1_412_337.2, y: 640_118.9 })).toBeNull();
    expect(centroidOf(null)).toBeNull();
    expect(centroidOf({ rings: [] })).toBeNull();
  });

  it("reads a page and says whether there is another", () => {
    const page = parseFeaturePage({
      exceededTransferLimit: true,
      fields: [{ name: "FULLADDR" }, { name: "ZIPCODE" }],
      features: [
        { attributes: { FULLADDR: "1550 SWEARINGEN DR", ZIPCODE: "21014" }, geometry: { x: -76.3, y: 39.5 } },
        { attributes: { FULLADDR: "12 TOLLGATE CT" } },
      ],
    });
    expect(page.exceededTransferLimit).toBe(true);
    expect(page.fields).toEqual(["FULLADDR", "ZIPCODE"]);
    expect(page.features[0]).toEqual({
      attributes: { FULLADDR: "1550 SWEARINGEN DR", ZIPCODE: "21014" },
      lat: 39.5,
      lng: -76.3,
    });
    expect(page.features[1].lat).toBeNull();
  });

  it("carries the server's error out rather than an empty page", () => {
    // An empty page ends an import cleanly. An error must not look like one.
    const page = parseFeaturePage({ error: { message: "Unable to complete operation." } });
    expect(page.error).toBe("Unable to complete operation.");
    expect(page.features).toHaveLength(0);
  });

  it("reads a count", () => {
    expect(parseCount({ count: 41_207 })).toBe(41_207);
    expect(parseCount({ error: {} })).toBeNull();
  });
});

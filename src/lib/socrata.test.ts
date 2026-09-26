import { describe, expect, it } from "vitest";

import { isSocrataUrl, parseSocrataCount, parseSocrataPage, socrataCountUrl, socrataFieldNames, socrataPageUrl, socrataWhere } from "./socrata";

describe("socrata urls", () => {
  it("tells a portal resource from an ArcGIS layer", () => {
    expect(isSocrataUrl("https://opendata.maryland.gov/resource/ed4q-f8tm.json")).toBe(true);
    expect(isSocrataUrl("https://opendata.maryland.gov/resource/ed4q-f8tm")).toBe(true);
    expect(isSocrataUrl("https://geodata.md.gov/imap/rest/services/PlanningCadastre/MD_PropertyData/MapServer/0")).toBe(false);
  });
  it("builds a page and a count", () => {
    const page = new URL(socrataPageUrl("https://opendata.maryland.gov/resource/ed4q-f8tm", "upper(county_name) like 'HARFORD%'", 2000, 1000));
    expect(page.pathname).toBe("/resource/ed4q-f8tm.json");
    expect(page.searchParams.get("$where")).toBe("upper(county_name) like 'HARFORD%'");
    expect(page.searchParams.get("$offset")).toBe("2000");
    expect(page.searchParams.get("$limit")).toBe("1000");
    expect(page.searchParams.get("$order")).toBe(":id");
    const count = new URL(socrataCountUrl("https://opendata.maryland.gov/resource/ed4q-f8tm.json", ""));
    expect(count.searchParams.get("$select")).toBe("count(*)");
    expect(count.searchParams.has("$where")).toBe(false);
  });
});

describe("socrata answers", () => {
  it("reads field names, rows and counts", () => {
    expect(socrataFieldNames([{ account_id: "1", county_name: "HARFORD" }])).toEqual(["account_id", "county_name"]);
    expect(parseSocrataPage([{ a: 1 }, null]).rows).toHaveLength(1);
    expect(parseSocrataPage({ message: "Invalid SoQL" }).error).toBe("Invalid SoQL");
    expect(parseSocrataCount([{ count: "117702" }])).toBe(117702);
    expect(parseSocrataCount([])).toBeNull();
  });
});

describe("socrataWhere", () => {
  it("uses the county name, then our ZIPs", () => {
    expect(socrataWhere({ county: "county_name" }, ["21014"])).toBe("upper(county_name) like 'HARFORD%'");
    expect(socrataWhere({ zip: "premise_address_zip_code" }, ["21014", "21009"])).toBe("premise_address_zip_code in ('21014','21009')");
    expect(socrataWhere({}, [])).toBe("");
  });
});

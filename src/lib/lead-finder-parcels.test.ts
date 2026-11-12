import { describe, expect, it } from "vitest";

import {
  acreageOf,
  classifyParcel,
  dedupeParcels,
  discoverFinderFields,
  finderParcelFromRecord,
  finderWhere,
  isOrganizationName,
  landUseCode,
  pointOf,
} from "@/lib/lead-finder-parcels";

// Field names as the State's open-data portal spells them.
const PORTAL_FIELDS = [
  "account_id_mdp_field_acctid",
  "county_name_mdp_field_cntyname",
  "premise_address_number_mdp_field_premsnum_sdat_field_20",
  "premise_address_name_mdp_field_premsnam_sdat_field_23",
  "premise_address_type_mdp_field_premstyp_sdat_field_24",
  "premise_address_city_mdp_field_premcity_sdat_field_25",
  "premise_address_zip_code_mdp_field_premzip_sdat_field_26",
  "record_key_owner_occupancy_code_mdp_field_ooi_sdat_field_6",
  "owner_name_1_mdp_field_ownname1_sdat_field_8",
  "mailing_address_state_mdp_field_ownstate_sdat_field_15",
  "mailing_address_line_1_mdp_field_ownadd1_sdat_field_12",
  "mailing_address_city_mdp_field_owncity_sdat_field_14",
  "land_use_code_mdp_field_lu_desclu_sdat_field_50",
  "c_a_m_a_system_data_land_area_mdp_field_landarea_sdat_field_241",
  "c_a_m_a_system_data_land_unit_of_measure_mdp_field_luom_sdat_field_242",
  "mdp_latitude_mdp_field_digycord_converted_to_wgs84",
  "mdp_longitude_mdp_field_digxcord_converted_to_wgs84",
  "current_assessment_year_total_assessment_sdat_field_172",
];

describe("discoverFinderFields", () => {
  it("maps the portal's long names", () => {
    const m = discoverFinderFields(PORTAL_FIELDS);
    expect(m.streetNumber).toBe("premise_address_number_mdp_field_premsnum_sdat_field_20");
    expect(m.landUse).toBe("land_use_code_mdp_field_lu_desclu_sdat_field_50");
    expect(m.landArea).toBe("c_a_m_a_system_data_land_area_mdp_field_landarea_sdat_field_241");
    expect(m.landUnit).toBe("c_a_m_a_system_data_land_unit_of_measure_mdp_field_luom_sdat_field_242");
    expect(m.lat).toBe("mdp_latitude_mdp_field_digycord_converted_to_wgs84");
    expect(m.lng).toBe("mdp_longitude_mdp_field_digxcord_converted_to_wgs84");
    expect(m.county).toBe("county_name_mdp_field_cntyname");
  });

  it("maps iMAP's short names", () => {
    const m = discoverFinderFields(["ACCTID", "ADDRESS", "CITY", "ZIPCODE", "OWNNAME1", "LU", "DESCLU", "ACRES", "JURSCODE"]);
    expect(m.acres).toBe("ACRES");
    expect(m.landUseDescription).toBe("DESCLU");
  });
});

describe("classifyParcel", () => {
  it("reads land-use codes in their several spellings", () => {
    expect(landUseCode("C")).toBe("C");
    expect(landUseCode("Commercial (C)")).toBe("C");
    expect(landUseCode("M - Apartments")).toBe("M");
    expect(classifyParcel("Commercial (C)", "ROCK SPRING STATION LLC")).toBe("commercial");
    expect(classifyParcel("M", "HERITAGE WOODS LP")).toBe("apartments");
    expect(classifyParcel("Industrial", null)).toBe("industrial");
  });

  it("lets the owner say church or HOA whatever the land use", () => {
    expect(classifyParcel("Exempt (E)", "FOREST HILL PRESBYTERIAN CHURCH")).toBe("church");
    expect(classifyParcel("Residential (R)", "BOX HILL SOUTH HOMEOWNERS ASSOCIATION INC")).toBe("hoa");
    expect(classifyParcel("R", "COUNCIL OF UNIT OWNERS OF THE GREENS CONDOMINIUM")).toBe("hoa");
  });

  it("leaves out homes, farms and government land", () => {
    expect(classifyParcel("Residential (R)", "SMITH JOHN")).toBeNull();
    expect(classifyParcel("Agricultural (A)", "SOME FARM LLC")).toBeNull();
    expect(classifyParcel("Exempt (E)", "HARFORD COUNTY MARYLAND")).toBeNull();
    expect(classifyParcel("Exempt (E)", "BOARD OF EDUCATION OF HARFORD COUNTY")).toBeNull();
    expect(classifyParcel("Exempt (E)", "DOE JANE")).toBeNull();
    expect(classifyParcel("Exempt (E)", "BEL AIR AMERICAN LEGION POST 39 INC")).toBe("institution");
  });
});

describe("isOrganizationName", () => {
  it("tells organizations from people", () => {
    expect(isOrganizationName("STACK & STORE FALLSTON LLC")).toBe(true);
    expect(isOrganizationName("ST MARK CATHOLIC CHURCH")).toBe(true);
    expect(isOrganizationName("SMITH JOHN & MARY")).toBe(false);
    expect(isOrganizationName("JOHN SMITH REVOCABLE TRUST")).toBe(false);
    expect(isOrganizationName(null)).toBe(false);
  });
});

describe("lot size and point", () => {
  it("reads acres, or land area by its unit", () => {
    const m = discoverFinderFields(["ACRES", "LANDAREA", "LUOM"]);
    expect(acreageOf({ ACRES: "2.5" }, m)).toBe(2.5);
    const n = discoverFinderFields(["LANDAREA", "LUOM"]);
    expect(acreageOf({ LANDAREA: "43560", LUOM: "S" }, n)).toBe(1);
    expect(acreageOf({ LANDAREA: "3.2", LUOM: "A" }, n)).toBe(3.2);
    expect(acreageOf({ LANDAREA: "87120" }, n)).toBe(2);
    expect(acreageOf({}, n)).toBeNull();
  });

  it("reads lat/lng columns, a portal point, or the feature's centroid", () => {
    const m = discoverFinderFields(["LATITUDE", "LONGITUDE", "LOCATION"]);
    expect(pointOf({ LATITUDE: "39.58", LONGITUDE: "-76.39" }, m)).toEqual({ lat: 39.58, lng: -76.39 });
    expect(pointOf({ LOCATION: { type: "Point", coordinates: [-76.39, 39.58] } }, m)).toEqual({ lat: 39.58, lng: -76.39 });
    expect(pointOf({ LATITUDE: "0", LONGITUDE: "0" }, m, { lat: 39.5, lng: -76.3 })).toEqual({ lat: 39.5, lng: -76.3 });
  });
});

describe("finderWhere", () => {
  it("asks for Harford, our ZIPs, and non-residential use or church/HOA owners", () => {
    const m = discoverFinderFields(PORTAL_FIELDS);
    const w = finderWhere(m, ["21050", "21014"]);
    expect(w).toContain("upper(county_name_mdp_field_cntyname) like 'HARFORD%'");
    expect(w).toContain("premise_address_zip_code_mdp_field_premzip_sdat_field_26 like '21050%'");
    expect(w).toContain("like '%COMMERCIAL%'");
    expect(w).toContain("upper(owner_name_1_mdp_field_ownname1_sdat_field_8) like '%CHURCH%'");
  });
});

describe("finderParcelFromRecord", () => {
  const m = discoverFinderFields(PORTAL_FIELDS);
  const row = (over: Record<string, unknown>) => ({
    account_id_mdp_field_acctid: "03 123456",
    county_name_mdp_field_cntyname: "Harford County",
    premise_address_number_mdp_field_premsnum_sdat_field_20: "1998",
    premise_address_name_mdp_field_premsnam_sdat_field_23: "ROCK SPRING",
    premise_address_type_mdp_field_premstyp_sdat_field_24: "RD",
    premise_address_city_mdp_field_premcity_sdat_field_25: "FOREST HILL",
    premise_address_zip_code_mdp_field_premzip_sdat_field_26: "21050",
    owner_name_1_mdp_field_ownname1_sdat_field_8: "ROCK SPRING STATION LLC",
    mailing_address_line_1_mdp_field_ownadd1_sdat_field_12: "100 MARKET ST",
    mailing_address_city_mdp_field_owncity_sdat_field_14: "PHILADELPHIA",
    mailing_address_state_mdp_field_ownstate_sdat_field_15: "PA",
    land_use_code_mdp_field_lu_desclu_sdat_field_50: "Commercial (C)",
    c_a_m_a_system_data_land_area_mdp_field_landarea_sdat_field_241: "5.1",
    c_a_m_a_system_data_land_unit_of_measure_mdp_field_luom_sdat_field_242: "A",
    mdp_latitude_mdp_field_digycord_converted_to_wgs84: "39.5741",
    mdp_longitude_mdp_field_digxcord_converted_to_wgs84: "-76.3913",
    current_assessment_year_total_assessment_sdat_field_172: "4200000",
    ...over,
  });

  it("reads a commercial parcel with an organization owner", () => {
    const p = finderParcelFromRecord(row({}), m)!;
    expect(p.category).toBe("commercial");
    expect(p.name).toBe("Rock Spring Station LLC");
    expect(p.address).toBe("1998 Rock Spring Rd");
    expect(p.city).toBe("Forest Hill");
    expect(p.zip).toBe("21050");
    expect(p.acreage).toBe(5.1);
    expect(p.lat).toBeCloseTo(39.5741);
    expect(p.ownerState).toBe("PA");
    expect(p.ownerMailing).toContain("PHILADELPHIA");
    expect(p.sourceKey).toBe("sdat:03123456");
    expect(p.priority).toBeGreaterThan(0);
  });

  it("keeps no name or mailing address for a person who owns a commercial lot", () => {
    const p = finderParcelFromRecord(row({ owner_name_1_mdp_field_ownname1_sdat_field_8: "SMITH JOHN" }), m)!;
    expect(p.ownerName).toBeNull();
    expect(p.ownerMailing).toBeNull();
    expect(p.name).toBe("1998 Rock Spring Rd");
    expect(JSON.stringify(p)).not.toMatch(/SMITH|MARKET ST/i);
  });

  it("drops homes and parcels with no street address", () => {
    expect(finderParcelFromRecord(row({ land_use_code_mdp_field_lu_desclu_sdat_field_50: "Residential (R)", owner_name_1_mdp_field_ownname1_sdat_field_8: "SMITH JOHN" }), m)).toBeNull();
    expect(finderParcelFromRecord(row({ premise_address_number_mdp_field_premsnum_sdat_field_20: "" , premise_address_name_mdp_field_premsnam_sdat_field_23: "" }), m)).toBeNull();
  });

  it("keeps the bigger lot when two accounts share an address", () => {
    const a = finderParcelFromRecord(row({ c_a_m_a_system_data_land_area_mdp_field_landarea_sdat_field_241: "1" }), m)!;
    const b = finderParcelFromRecord(row({ account_id_mdp_field_acctid: "03 999", c_a_m_a_system_data_land_area_mdp_field_landarea_sdat_field_241: "4" }), m)!;
    expect(dedupeParcels([a, b])).toEqual([b]);
  });
});

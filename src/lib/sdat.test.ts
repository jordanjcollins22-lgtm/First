import { describe, expect, it } from "vitest";

import {
  discoverSdatFields,
  occupancyOf,
  ownershipFromRecord,
  parsePrincipalResidence,
  parseSdatDate,
  sdatMappingIsUsable,
  sdatWhere,
} from "./sdat";

describe("discoverSdatFields", () => {
  it("maps MdProperty View's names whatever their case", () => {
    const mapping = discoverSdatFields(["OBJECTID", "acctid", "ADDRESS", "CITY", "ZIPCODE", "OWNNAME1", "OWNADD1", "OWNCITY", "OWNSTA", "OWNZIP", "RESIDENT", "TRADATE", "CONSIDR1", "YEARBLT", "DESCLU", "NFMTTLVL", "JURSCODE"]);
    expect(mapping.account).toBe("acctid");
    expect(mapping.address).toBe("ADDRESS");
    expect(mapping.principalResidence).toBe("RESIDENT");
    expect(mapping.transferDate).toBe("TRADATE");
    expect(mapping.jurisdiction).toBe("JURSCODE");
    expect(sdatMappingIsUsable(mapping)).toBe(true);
  });
  it("reads the open-data portal's long column names by prefix", () => {
    const mapping = discoverSdatFields([
      "county_name_mdp_field_cntyname",
      "account_id_mdp_field_acctid",
      "record_key_owner_occupancy_code_mdp_field_ooi_sdat_field_6",
      "mdp_street_address_mdp_field_address",
      "mdp_street_address_city_mdp_field_city",
      "mdp_street_address_zip_code_mdp_field_zipcode",
      "premise_address_number_mdp_field_premsnum_sdat_field_20",
      "premise_address_name_mdp_field_premsnam_sdat_field_23",
      "premise_address_type_mdp_field_premstyp_sdat_field_24",
      "premise_address_city_mdp_field_premcity_sdat_field_25",
      "premise_address_zip_code_mdp_field_premzip_sdat_field_26",
      "land_use_code_mdp_field_lu_desclu_sdat_field_50",
      "sales_segment_1_transfer_date_yyyy_mm_dd_mdp_field_tradate_sdat_field_89",
      "sales_segment_1_consideration_mdp_field_considr1_sdat_field_90",
      "current_assessment_year_total_assessment_sdat_field_172",
      "c_a_m_a_system_data_year_built_yyyy_mdp_field_yearblt_sdat_field_235",
    ]);
    expect(mapping.county).toBe("county_name_mdp_field_cntyname");
    expect(mapping.account).toBe("account_id_mdp_field_acctid");
    expect(mapping.address).toBe("mdp_street_address_mdp_field_address");
    expect(mapping.city).toBe("premise_address_city_mdp_field_premcity_sdat_field_25");
    expect(mapping.zip).toBe("premise_address_zip_code_mdp_field_premzip_sdat_field_26");
    expect(mapping.streetNumber).toBe("premise_address_number_mdp_field_premsnum_sdat_field_20");
    expect(mapping.streetName).toBe("premise_address_name_mdp_field_premsnam_sdat_field_23");
    expect(mapping.streetType).toBe("premise_address_type_mdp_field_premstyp_sdat_field_24");
    expect(mapping.principalResidence).toBe("record_key_owner_occupancy_code_mdp_field_ooi_sdat_field_6");
    expect(mapping.transferDate).toBe("sales_segment_1_transfer_date_yyyy_mm_dd_mdp_field_tradate_sdat_field_89");
    expect(mapping.consideration).toBe("sales_segment_1_consideration_mdp_field_considr1_sdat_field_90");
    expect(mapping.yearBuilt).toBe("c_a_m_a_system_data_year_built_yyyy_mdp_field_yearblt_sdat_field_235");
    expect(mapping.assessedValue).toBe("current_assessment_year_total_assessment_sdat_field_172");
    expect(mapping.landUse).toBe("land_use_code_mdp_field_lu_desclu_sdat_field_50");
    expect(mapping.ownerName).toBeUndefined();
  });

  it("is unusable without an address", () => {
    expect(sdatMappingIsUsable(discoverSdatFields(["OBJECTID", "OWNNAME1"]))).toBe(false);
    expect(sdatMappingIsUsable(discoverSdatFields(["STRTNUM", "STRTNAM"]))).toBe(true);
  });
});

describe("sdatWhere", () => {
  it("prefers the jurisdiction code, then the county, then our ZIPs", () => {
    expect(sdatWhere({ jurisdiction: "JURSCODE", zip: "ZIPCODE" }, ["21014"])).toBe("JURSCODE = 'HARF'");
    expect(sdatWhere({ county: "COUNTY" }, [])).toBe("UPPER(COUNTY) LIKE 'HARFORD%'");
    expect(sdatWhere({ zip: "ZIPCODE" }, ["21014", "21009"])).toBe("ZIPCODE IN ('21014','21009')");
    expect(sdatWhere({ zip: "ZIPCODE" }, ["21014"], true)).toBe("ZIPCODE IN (21014)");
    expect(sdatWhere({}, [])).toBe("1=1");
  });
});

describe("dates and flags", () => {
  it("reads the roll's several date spellings", () => {
    expect(parseSdatDate("20240315")).toBe("2024-03-15");
    expect(parseSdatDate("2024-03-15T00:00:00")).toBe("2024-03-15");
    expect(parseSdatDate("3/5/2024")).toBe("2024-03-05");
    expect(parseSdatDate(1710460800000)).toBe("2024-03-15");
    expect(parseSdatDate("00000000")).toBeNull();
    expect(parseSdatDate(null)).toBeNull();
  });
  it("reads the principal-residence flag", () => {
    expect(parsePrincipalResidence("Y")).toBe(true);
    expect(parsePrincipalResidence("PRINCIPAL RESIDENCE")).toBe(true);
    expect(parsePrincipalResidence("N")).toBe(false);
    expect(parsePrincipalResidence("NOT A PRINCIPAL RESIDENCE")).toBe(false);
    expect(parsePrincipalResidence("")).toBeNull();
  });
});

describe("occupancyOf", () => {
  it("is owner-occupied when the bill goes to the house, however it is spelled", () => {
    const r = occupancyOf("1550 SWEARINGEN RD", "21014", { line1: "1550 Swearingen Road", line2: null, city: "BEL AIR", state: "MD", zip: "21014-1234" }, false);
    expect(r.ownerOccupied).toBe(true);
    expect(r.reason).toMatch(/goes to the house/);
  });
  it("is absentee when the bill goes elsewhere, and says where", () => {
    const r = occupancyOf("12 OAK LN", "21014", { line1: "PO BOX 44", line2: null, city: "TOWSON", state: "MD", zip: "21204" }, true);
    expect(r.ownerOccupied).toBe(false);
    expect(r.reason).toContain("PO BOX 44, TOWSON MD 21204");
  });
  it("falls back to the flag when there is no mailing address", () => {
    expect(occupancyOf("12 OAK LN", "21014", { line1: null, line2: null, city: null, state: null, zip: null }, true).ownerOccupied).toBe(true);
    expect(occupancyOf("12 OAK LN", "21014", { line1: null, line2: null, city: null, state: null, zip: null }, null).ownerOccupied).toBeNull();
  });
});

describe("ownershipFromRecord", () => {
  const mapping = discoverSdatFields(["ACCTID", "ADDRESS", "CITY", "ZIPCODE", "OWNNAME1", "OWNNAME2", "OWNADD1", "OWNCITY", "OWNSTA", "OWNZIP", "RESIDENT", "TRADATE", "CONSIDR1", "YEARBLT", "DESCLU", "NFMTTLVL"]);
  it("reads a whole record into our key and facts", () => {
    const record = ownershipFromRecord(
      {
        ACCTID: "13 012345",
        ADDRESS: "1550 SWEARINGEN RD",
        CITY: "BEL AIR",
        ZIPCODE: "21014",
        OWNNAME1: "SMITH JOHN",
        OWNNAME2: "SMITH JANE",
        OWNADD1: "8 ELM ST",
        OWNCITY: "ABERDEEN",
        OWNSTA: "MD",
        OWNZIP: "21001",
        RESIDENT: "N",
        TRADATE: "20230712",
        CONSIDR1: "425000",
        YEARBLT: "1988",
        DESCLU: "RESIDENTIAL",
        NFMTTLVL: "398300",
      },
      mapping
    );
    expect(record).not.toBeNull();
    expect(record!.normalized).toBe("1550 SWEARINGEN RD BEL AIR MD 21014");
    expect(record!.ownerName).toBe("SMITH JOHN & SMITH JANE");
    expect(record!.ownerOccupied).toBe(false);
    expect(record!.lastSaleDate).toBe("2023-07-12");
    expect(record!.lastSalePrice).toBe(425000);
    expect(record!.yearBuilt).toBe(1988);
    expect(record!.assessedValue).toBe(398300);
  });
  it("gives nothing for a parcel without an address", () => {
    expect(ownershipFromRecord({ ACCTID: "13 9", OWNNAME1: "STATE OF MD" }, mapping)).toBeNull();
  });
});

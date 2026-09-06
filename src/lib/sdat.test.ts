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

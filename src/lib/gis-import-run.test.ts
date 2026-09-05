import { describe, expect, it } from "vitest";

import { newTickToken, selfBaseUrl, tokenMatches, whereFor, type JobRow } from "@/lib/gis-import-run";
import { discoverFields } from "@/lib/gis-import";

function job(over: Partial<JobRow>): JobRow {
  return { kind: "zip", scope: { zip: "21014" }, ...over } as JobRow;
}

describe("whereFor", () => {
  it("bounds a ZIP run to the ZIP, by the layer's own field when it has one", () => {
    const mapping = discoverFields(["FULLADDR", "ZIPCODE"]);
    expect(whereFor(job({}), mapping)).toBe("ZIPCODE LIKE '21014%'");
  });

  it("falls back to the address text when the layer has no ZIP field", () => {
    const mapping = discoverFields(["FULLADDR"]);
    expect(whereFor(job({}), mapping)).toBe("FULLADDR LIKE '%21014%'");
  });

  it("bounds ZIP 21014 by P_Z_1, the field Harford's Address Master actually has", () => {
    // The clause the bounded run will send. Not the address text: the layer
    // keeps the ZIP in its own column, and the address field has no ZIP in it.
    const mapping = discoverFields(["OBJECTID", "P_CITY", "P_Z_1", "Address", "UnitNumber", "UnitType", "GlobalID"]);
    expect(whereFor(job({}), mapping)).toBe("P_Z_1 LIKE '21014%'");
  });

  it("asks for everything on a county run", () => {
    // "Do not import the entire county yet" is enforced by which button was
    // pressed, and this is the only place the two runs differ.
    const mapping = discoverFields(["FULLADDR", "ZIPCODE"]);
    expect(whereFor(job({ kind: "county", scope: {} }), mapping)).toBe("1=1");
  });
});

describe("selfBaseUrl", () => {
  it("uses the request's own origin, so a step stays inside its own deployment", () => {
    expect(selfBaseUrl("https://app.example.com")).toBe("https://app.example.com");
    expect(selfBaseUrl("https://app.example.com/")).toBe("https://app.example.com");
  });
});

describe("tick tokens", () => {
  it("are long, random and match only themselves", () => {
    const a = newTickToken();
    const b = newTickToken();
    expect(a).toHaveLength(64);
    expect(a).not.toBe(b);
    expect(tokenMatches(a, a)).toBe(true);
    expect(tokenMatches(a, b)).toBe(false);
  });

  it("refuse anything that is not exactly the token", () => {
    const token = newTickToken();
    expect(tokenMatches(token, token.slice(0, -1))).toBe(false);
    expect(tokenMatches(token, `${token}x`)).toBe(false);
    expect(tokenMatches(token, undefined)).toBe(false);
    expect(tokenMatches(null, "anything")).toBe(false);
    expect(tokenMatches(token, 42)).toBe(false);
  });
});

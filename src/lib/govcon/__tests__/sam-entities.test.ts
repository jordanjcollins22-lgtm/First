import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { verifySmallStatus } from "../quote-selection";
import { parseEntityLine, streamSamEntities } from "../sources/sam-entities";

function line(overrides: Record<number, string>): string {
  const f = Array.from({ length: 142 }, () => "");
  Object.assign(f, {
    0: "VZCLHNYYTGM7",
    3: "21C39",
    5: "A",
    8: "20270604",
    11: "JLBB ENTERPRISES LLC",
    15: "226 ARIS AVE",
    17: "METAIRIE",
    18: "LA",
    19: "70005",
    21: "USA",
    26: "jlbb.com",
    31: "2X~LJ~A5",
    34: "238220Y~561210Y~561730N~541611Y",
    46: "JONATHAN",
    48: "LEA",
    ...overrides,
  });
  return f.join("|");
}

describe("parseEntityLine", () => {
  it("parses a real-format record with per-NAICS small flags", () => {
    const e = parseEntityLine(line({}))!;
    expect(e.uei).toBe("VZCLHNYYTGM7");
    expect(e.state).toBe("LA");
    expect(e.website).toBe("https://jlbb.com");
    expect(e.naics).toEqual(["238220", "561210", "561730", "541611"]);
    expect(e.small_naics).toEqual(["238220", "561210", "541611"]);
    expect(e.poc_name).toBe("JONATHAN LEA");
    expect(e.registration_expires).toBe("2027-06-04");
  });

  it("skips inactive, foreign, header and out-of-trade records", () => {
    expect(parseEntityLine("BOF PUBLIC V2 00000000 20261005 0905712 0008359")).toBeNull();
    expect(parseEntityLine(line({ 5: "E" }))).toBeNull();
    expect(parseEntityLine(line({ 21: "CAN" }))).toBeNull();
    expect(parseEntityLine(line({ 34: "711190Y~711120 " }))).toBeNull();
  });

  it("streams through the nested zip", async () => {
    const dat = ["BOF PUBLIC V2", line({}), line({ 0: "SECOND", 34: "561720Y" }), line({ 0: "SKIP", 34: "711190Y" })].join("\n") + "\n";
    const inner = zipSync({ "SAM_PUBLIC.dat": strToU8(dat) });
    const outer = zipSync({ "SAM_PUBLIC.ZIP": inner }, { level: 0 });
    const body = new Blob([outer]).stream();
    const seen: string[] = [];
    const r = await streamSamEntities(body, (e) => void seen.push(e.uei));
    expect(seen).toEqual(["VZCLHNYYTGM7", "SECOND"]);
    expect(r.matched).toBe(2);
  });
});

describe("verifySmallStatus", () => {
  it("lets the SAM registration override a self-certification", () => {
    expect(verifySmallStatus({ selfCertified: true, registry: { small_naics: ["561730"] }, naics: ["561730"] })).toMatchObject({ isSmall: true, verified: true, warning: null });
    const bad = verifySmallStatus({ selfCertified: true, registry: { small_naics: [] }, naics: ["561730"] });
    expect(bad.isSmall).toBe(false);
    expect(bad.warning).toMatch(/isn't small/);
    expect(verifySmallStatus({ selfCertified: true, registry: null, naics: ["561730"] })).toMatchObject({ isSmall: true, verified: false });
  });
});

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { DEFAULT_PROFILE } from "../profile";
import { scoreOpportunity } from "../scoring";
import { BONFIRE_PORTALS, bonfireToOpportunity, zonedWallTimeToUtc } from "../sources/bonfire";
import { xlsxToText } from "../xlsx";

describe("zonedWallTimeToUtc", () => {
  it("converts portal-local close times, including DST", () => {
    expect(zonedWallTimeToUtc("2026-10-07 17:00:00", "America/Denver")).toBe("2026-10-07T23:00:00.000Z"); // MDT
    expect(zonedWallTimeToUtc("2026-12-07 17:00:00", "America/Denver")).toBe("2026-12-08T00:00:00.000Z"); // MST
    expect(zonedWallTimeToUtc("2026-07-01 12:00:00", "America/Phoenix")).toBe("2026-07-01T19:00:00.000Z"); // no DST
    expect(zonedWallTimeToUtc("garbage", "America/Denver")).toBeNull();
  });
});

describe("bonfireToOpportunity", () => {
  const utah = BONFIRE_PORTALS.find((p) => p.subdomain === "utah")!;
  it("normalizes a portal project into a state/local opportunity", () => {
    const opp = bonfireToOpportunity(
      { ProjectID: "255281", ReferenceID: "AM27-118", ProjectName: "5 Year Contract for Janitorial services", DateClose: "2026-10-22 20:00:00", DepartmentID: "1" },
      utah,
      "DWR"
    );
    expect(opp.externalId).toBe("bonfire:utah:255281");
    expect(opp.source).toBe("state_portal");
    expect(opp.placeOfPerformance.state).toBe("UT");
    expect(opp.url).toBe("https://utah.bonfirehub.com/opportunities/255281");
    const s = scoreOpportunity(opp, DEFAULT_PROFILE, { now: new Date("2026-10-07T12:00:00Z") });
    expect(s.trade).toBe("janitorial");
    expect(s.subcontracting.status).toBe("unrestricted");
  });

  it("drops product purchases and prequalified-only bids", () => {
    const now = new Date("2026-10-07T12:00:00Z");
    for (const title of ["SLCo PWO130995-1 Asphalt Concrete Mix - RFC", "DFCM Construction - Prequalified Mechanical Stage II"]) {
      const opp = bonfireToOpportunity({ ProjectID: "1", ProjectName: title, DateClose: "2026-11-01 12:00:00" }, utah, null);
      expect(scoreOpportunity(opp, DEFAULT_PROFILE, { now }).recommendation).toBe("no_bid");
    }
  });
});

describe("xlsxToText", () => {
  it("reads shared strings, inline strings and numbers by column", () => {
    const xlsx = zipSync({
      "xl/workbook.xml": strToU8('<workbook><sheets><sheet name="Pricing" sheetId="1"/></sheets></workbook>'),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>CLIN</t></si><si><t>Mowing &amp; trimming</t></si></sst>"),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Acres</t></is></c></row>' +
          '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>40</v></c></row></sheetData></worksheet>'
      ),
    });
    expect(xlsxToText(xlsx)).toBe("## Sheet: Pricing\nCLIN\t\tAcres\nMowing & trimming\t\t40");
  });
});

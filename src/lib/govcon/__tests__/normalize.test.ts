import { describe, expect, it } from "vitest";

import { latestByKey, normalizeDate, normalizeNoticeType, normalizeSetAside, opportunityKey, parseMoney } from "../normalize";

describe("normalize", () => {
  it("maps SAM set-aside codes, including JSON-wrapped and sole-source codes", () => {
    expect(normalizeSetAside("SBA")).toBe("small_business");
    expect(normalizeSetAside('["SBA"]')).toBe("small_business");
    expect(normalizeSetAside("")).toBe("none");
    expect(normalizeSetAside("NONE")).toBe("none");
    expect(normalizeSetAside("SDVOSBC")).toBe("sdvosb");
    expect(normalizeSetAside("8AN")).toBe("other"); // sole source
  });

  it("maps notice types from the CSV words and API codes", () => {
    expect(normalizeNoticeType("Combined Synopsis/Solicitation")).toBe("combined_synopsis_solicitation");
    expect(normalizeNoticeType("o")).toBe("solicitation");
    expect(normalizeNoticeType("Sources Sought")).toBe("sources_sought");
    expect(normalizeNoticeType("Justification")).toBe("other");
  });

  it("parses SAM date formats", () => {
    expect(normalizeDate("2026-10-06 03:42:50")).toBe("2026-10-06T03:42:50.000Z");
    expect(normalizeDate("2026-12-31T12:00:00+01:00")).toBe("2026-12-31T11:00:00.000Z");
    expect(normalizeDate("")).toBeNull();
  });

  it("parses money", () => {
    expect(parseMoney("66264.00")).toBe(66264);
    expect(parseMoney("$1,250")).toBe(1250);
    expect(parseMoney("")).toBeNull();
  });

  it("collapses amendments of the same solicitation to the latest notice", () => {
    const base = { solicitationNumber: "W912-26-Q-0001", agency: "DEPT OF DEFENSE" };
    const items = [
      { ...base, externalId: "a", postedDate: "2026-10-01" },
      { ...base, solicitationNumber: "w91226q0001", externalId: "b", postedDate: "2026-10-05" },
      { externalId: "c", solicitationNumber: null, agency: null, postedDate: "2026-10-02" },
    ];
    expect(opportunityKey(items[0])).toBe(opportunityKey(items[1]));
    expect(latestByKey(items).map((i) => i.externalId).sort()).toEqual(["b", "c"]);
  });
});

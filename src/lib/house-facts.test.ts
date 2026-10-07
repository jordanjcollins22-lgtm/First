import { describe, expect, it } from "vitest";

import { occupancyLine, renderHouseCard, sdatLink, type HouseFacts } from "./house-facts";

const base: HouseFacts = {
  id: "h1",
  address: "1550 SWEARINGEN RD, BEL AIR, MD 21014",
  lat: 39.5,
  lng: -76.3,
  countyPin: true,
  kind: { kind: "townhome", units: 1, basis: "State land use TH; owner lives here" },
  stageRank: 4,
  events: [{ kind: "client", at: "2026-05-02T00:00:00Z", amountCents: 250000, note: null }],
  contacts: [{ id: "c1", name: "Pat <Smith>", phone: "410-555-0100", role: "owner", doNotContact: false }],
  ownership: {
    ownerOccupied: false,
    reason: "Not the owner's principal residence",
    ownerName: null,
    lastSaleDate: "2026-03-12",
    lastSalePrice: 340000,
    yearBuilt: 1990,
    landUse: "Town House (TH)",
    assessedValue: 298000,
    accountId: "1301193201",
    fetchedAt: "2026-09-06T14:00:00Z",
  },
  route: { zip: "21014", routeId: "C002", walkability: "walkable", reason: null, distanceM: 24, houseCount: 620, waveId: "w1", waveName: "USPS 21014 C002", waveStatus: "planned", zoneId: "z1", zoneName: "21014 C002" },
  unserved: false,
  hangers: { count: 2, last: "2026-08-01T12:00:00Z", designs: [1, 2] },
};

describe("sdatLink", () => {
  it("splits the account id into county, district and account", () => {
    expect(sdatLink("1301193201")).toBe("https://sdat.dat.maryland.gov/RealProperty/Pages/viewdetails.aspx?County=13&SearchType=ACCT&District=01&AccountNumber=193201");
    expect(sdatLink(null)).toBeNull();
  });
});

describe("occupancyLine", () => {
  it("says a client at a rented house is a tenant", () => {
    expect(occupancyLine(base).text).toMatch(/tenants/);
    expect(occupancyLine({ ...base, stageRank: 0 }).text).toMatch(/lives elsewhere/);
    expect(occupancyLine({ ...base, ownership: { ...base.ownership!, ownerOccupied: true } }).text).toBe("Owner lives here");
    expect(occupancyLine({ ...base, ownership: null }).tone).toBe("muted");
  });
});

describe("renderHouseCard", () => {
  it("shows every section, escaped", () => {
    const html = renderHouseCard(base);
    expect(html).toContain("1550 SWEARINGEN RD");
    expect(html).toContain("Client");
    expect(html).toContain("Pat &lt;Smith&gt;");
    expect(html).toContain("/clients/c1");
    expect(html).toContain("tenants");
    expect(html).toContain("new owners");
    expect(html).toContain("$340,000");
    expect(html).toContain("USPS route 21014 C002");
    expect(html).toContain("USPS 21014 C002");
    expect(html).toContain("2 hangers so far");
    expect(html).toContain("State record");
    expect(html).toContain("Townhome");
  });
  it("says what kind of door it is, with the units when there are many", () => {
    const html = renderHouseCard({ ...base, kind: { kind: "apartment", units: 179, basis: "State land use M; 179 units at this address" } });
    expect(html).toContain("Apartment");
    expect(html).toContain("179 units at this address");
    expect(renderHouseCard({ ...base, kind: null })).toContain("Not yet classified");
  });
  it("says when nothing reaches a house nobody knows", () => {
    const html = renderHouseCard({ ...base, stageRank: 0, events: [], contacts: [], ownership: null, route: null, unserved: true, hangers: { count: 0, last: null, designs: [] } });
    expect(html).toContain("Nobody on record here");
    expect(html).toContain("Not on the State's roll");
    expect(html).toContain("No USPS route reaches this house");
    expect(html).toContain("No hangers yet");
  });
});

import { describe, expect, it } from "vitest";

import { resolveParcel, type ExistingHouse, type ParcelRecord } from "@/lib/gis-import";

/**
 * The gate the county import has to pass before it runs on ninety thousand
 * addresses.
 *
 * These are not invented fixtures. Every id and normalized key below was read
 * out of the live database, and the six parcels are shaped like what the
 * county's layer returns. Whatever this file says the importer will do is
 * exactly what was then done to the real rows, and the result was checked
 * against it -- so a change to the resolution logic that would have created a
 * duplicate fails here rather than in Harford County.
 */

/** Read from `houses` before the sample ran. */
const SWEARINGEN = "a02843b1-5634-47d8-b5da-9fc83e293d4c";
const LONG_DRIVE = "6ae71690-3bcf-475e-910c-dbfb200c3283";
const CRESTWOOD_MD = "ecd16370-a8d7-4744-9618-d742148bb3a0";
const CRESTWOOD_AU = "899eee03-5f3d-4cfb-b9fb-7996ce29f1ff";
const EMMORTON = "896d8b9b-8d35-466d-bcdb-366b62686996";

const LIVE_HOUSES: ExistingHouse[] = [
  // Carries a real evaluation and a real proposal. The one that must not move.
  { id: SWEARINGEN, normalizedAddress: "1550 SWEARINGEN DR BEL AIR MD 21014" },
  { id: LONG_DRIVE, normalizedAddress: "801 LONG DR ABERDEEN MD 21001" },
  { id: CRESTWOOD_MD, normalizedAddress: "319 CRESTWOOD DR EDGEWOOD MD 21040" },
  // The geocoder's rewrite of the row above. Held, and must stay held.
  {
    id: CRESTWOOD_AU,
    normalizedAddress: "319 CRESTWOOD DR PORT MACQUARIE NEW S WALES 2444 AUSTRALIA",
  },
  // A street, not a house. Held.
  { id: EMMORTON, normalizedAddress: "EMMORTON RD EDGEWOOD MD 21040" },
];

function parcel(address: string, parcelId: string): ParcelRecord {
  return {
    parcelId,
    address,
    // Real Harford coordinates. They take no part in any decision, which is
    // itself one of the things being proved.
    lat: 39.5359,
    lng: -76.3483,
    ownerName: "PUBLIC RECORD OWNER",
    lotSizeSqft: 11000,
  };
}

/** The six parcels the sample feeds in, and nothing else. */
export const SAMPLE = [
  parcel("1550 SWEARINGEN DR, BEL AIR, MD 21014", "03-000001"),
  parcel("801 LONG DR, ABERDEEN, MD 21001", "03-000002"),
  parcel("12 TOLLGATE CT, BEL AIR, MD 21014", "03-000003"),
  parcel("EMMORTON RD, EDGEWOOD, MD 21040", "03-000004"),
  parcel("319 CRESTWOOD DR, EDGEWOOD, MD 21040", "03-000005"),
  parcel("1550 SWEARINGEN DR, BEL AIR, MD", "03-000006"),
];

describe("the Harford sample, before the county import may run", () => {
  it("1. enriches the existing house that carries an evaluation and a proposal", () => {
    expect(resolveParcel(SAMPLE[0], LIVE_HOUSES)).toEqual({
      action: "enrich",
      houseId: SWEARINGEN,
      normalized: "1550 SWEARINGEN DR BEL AIR MD 21014",
    });
  });

  it("2. enriches a second existing house rather than making a new one", () => {
    expect(resolveParcel(SAMPLE[1], LIVE_HOUSES)).toMatchObject({
      action: "enrich",
      houseId: LONG_DRIVE,
    });
  });

  it("3. creates exactly one house for Harford ground we have never seen", () => {
    expect(resolveParcel(SAMPLE[2], LIVE_HOUSES)).toEqual({
      action: "create",
      normalized: "12 TOLLGATE CT BEL AIR MD 21014",
      kind: "house",
    });
  });

  it("4. skips the street, leaving the held record held", () => {
    // Not "creates a held house": the county has thousands of these, and each
    // one would be a line in a review queue nobody could get through.
    expect(resolveParcel(SAMPLE[3], LIVE_HOUSES)).toMatchObject({ action: "skip" });
  });

  it("5. enriches the Maryland Crestwood row and never touches the Australian one", () => {
    const decision = resolveParcel(SAMPLE[4], LIVE_HOUSES);
    expect(decision).toMatchObject({ action: "enrich", houseId: CRESTWOOD_MD });
    // The bad row shares a house number and a street with this parcel. It is
    // not adopted, because its normalized key says Port Macquarie.
    expect(decision).not.toMatchObject({ houseId: CRESTWOOD_AU });
  });

  it("6. asks about the ambiguous one instead of creating a duplicate", () => {
    const decision = resolveParcel(SAMPLE[5], LIVE_HOUSES);
    expect(decision).toMatchObject({ action: "review", candidateHouseId: SWEARINGEN });
  });

  it("creates exactly one new house across the whole sample", () => {
    const created = SAMPLE.map((p) => resolveParcel(p, LIVE_HOUSES)).filter(
      (d) => d.action === "create"
    );
    expect(created).toHaveLength(1);
  });

  it("is idempotent: re-running against the enriched houses changes nothing", () => {
    // The second run sees the house the first run created, so the parcel that
    // created it now resolves to enriching it. Nothing else moves.
    const after: ExistingHouse[] = [
      ...LIVE_HOUSES,
      { id: "h-new-tollgate", normalizedAddress: "12 TOLLGATE CT BEL AIR MD 21014" },
    ];
    const second = SAMPLE.map((p) => resolveParcel(p, after));

    expect(second.filter((d) => d.action === "create")).toHaveLength(0);
    expect(second[2]).toMatchObject({ action: "enrich", houseId: "h-new-tollgate" });
    expect(second[0]).toMatchObject({ action: "enrich", houseId: SWEARINGEN });
    expect(second[3]).toMatchObject({ action: "skip" });
    expect(second[5]).toMatchObject({ action: "review" });
  });
});

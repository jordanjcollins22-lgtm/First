import { describe, expect, it } from "vitest";

import {
  discoverFields,
  mappingIsUsable,
  pickField,
  resolveParcel,
  type ExistingHouse,
  type ParcelRecord,
} from "@/lib/gis-import";
import { normalizeAddress } from "@/lib/address-normalize";

const BEL_AIR = { lat: 39.5359, lng: -76.3483 };

function parcel(over: Partial<ParcelRecord> = {}): ParcelRecord {
  return {
    parcelId: "03-123456",
    address: "1550 SWEARINGEN DR, BEL AIR, MD 21014",
    lat: BEL_AIR.lat,
    lng: BEL_AIR.lng,
    ownerName: "SMITH JOHN",
    lotSizeSqft: 12000,
    ...over,
  };
}

function house(id: string, address: string): ExistingHouse {
  return { id, normalizedAddress: normalizeAddress(address) };
}

/** The five cases the sample has to cover, as fixtures. */
const EXISTING: ExistingHouse[] = [
  // 1. a known house with a real evaluation and proposal on it
  house("h-swearingen", "1550 Swearingen Drive, Bel Air, Maryland 21014, United States"),
  // 2. another clean client house
  house("h-longdrive", "801 Long Drive, Aberdeen, Maryland 21001, United States"),
  // 3. a street-only record already held
  house("h-emmorton", "Emmorton Road, Edgewood, Maryland 21040, United States"),
  // 4. a bad foreign geocode
  house("h-crestwood-au", "319 Crestwood Drive, Port Macquarie New South Wales 2444, Australia"),
];

describe("resolveParcel", () => {
  it("enriches the house we already have, rather than making a second one", () => {
    // The expensive mistake. A house carries the evaluations, the proposals
    // and the money; a duplicate splits that history and neither half is right.
    const decision = resolveParcel(parcel(), EXISTING);
    expect(decision).toEqual({
      action: "enrich",
      houseId: "h-swearingen",
      normalized: "1550 SWEARINGEN DR BEL AIR MD 21014",
    });
  });

  it("enriches through a different spelling of the same address", () => {
    const decision = resolveParcel(
      parcel({ address: "801 Long Drive, Aberdeen, Maryland 21001" }),
      EXISTING
    );
    expect(decision).toMatchObject({ action: "enrich", houseId: "h-longdrive" });
  });

  it("creates a Harford house we have never seen", () => {
    const decision = resolveParcel(
      parcel({ parcelId: "03-999999", address: "12 Tollgate Court, Bel Air, MD 21014" }),
      EXISTING
    );
    expect(decision).toEqual({
      action: "create",
      normalized: "12 TOLLGATE CT BEL AIR MD 21014",
      kind: "house",
    });
  });

  it("skips a parcel with no house number instead of creating a held one", () => {
    // A county feed carries rights of way, common ground and unaddressed lots.
    // Creating a held house for each would bury the review queue.
    const decision = resolveParcel(parcel({ address: "Emmorton Road, Edgewood, MD 21040" }), EXISTING);
    expect(decision).toMatchObject({ action: "skip" });
  });

  it("skips a parcel with no address at all", () => {
    expect(resolveParcel(parcel({ address: "" }), EXISTING)).toMatchObject({ action: "skip" });
  });

  it("asks about a near match rather than creating a duplicate", () => {
    // Same house, missing its ZIP. Creating this would be the duplicate the
    // whole design exists to prevent.
    const decision = resolveParcel(
      parcel({ address: "1550 Swearingen Dr, Bel Air, MD" }),
      EXISTING
    );
    expect(decision).toMatchObject({ action: "review", candidateHouseId: "h-swearingen" });
  });

  it("does not ask about two houses on one street", () => {
    // 1628 and 1638 Eva Mar share every word but the number, and are two
    // different families. A different number is a different house.
    const withEvaMar = [...EXISTING, house("h-1628", "1628 Eva Mar Blvd, Bel Air, MD 21015")];
    const decision = resolveParcel(
      parcel({ address: "1638 Eva Mar Blvd, Bel Air, MD 21015" }),
      withEvaMar
    );
    expect(decision).toMatchObject({ action: "create" });
  });

  it("creates rather than links when the county gives a Harford address we hold only badly", () => {
    // The Australian row is "319 Crestwood Drive, Port Macquarie". The county's
    // "319 Crestwood Drive, Edgewood MD" is a different normalized key, so it
    // is new ground -- the bad row is not quietly adopted as this house.
    const decision = resolveParcel(
      parcel({ address: "319 Crestwood Drive, Edgewood, MD 21040" }),
      EXISTING
    );
    expect(decision).toMatchObject({ action: "create" });
  });

  it("never links on coordinates", () => {
    // Same address, absurd pin. The pin is the half that was wrong, so it
    // changes nothing about identity.
    const decision = resolveParcel(parcel({ lat: -31.43, lng: 152.9 }), EXISTING);
    expect(decision).toMatchObject({ action: "enrich", houseId: "h-swearingen" });
  });

  it("creates against an empty database", () => {
    expect(resolveParcel(parcel(), [])).toMatchObject({ action: "create" });
  });

  it("prefers the exact match over a near one", () => {
    const both = [
      house("h-near", "1550 Swearingen Dr, Bel Air, MD"),
      house("h-exact", "1550 Swearingen Drive, Bel Air, Maryland 21014, United States"),
    ];
    expect(resolveParcel(parcel(), both)).toMatchObject({ action: "enrich", houseId: "h-exact" });
  });
});

describe("pickField", () => {
  it("finds the county's address column whatever it is called", () => {
    expect(pickField(["OBJECTID", "SITUS_ADDRESS", "OWNNAME"], "address")).toBe("SITUS_ADDRESS");
    expect(pickField(["objectid", "fulladdr"], "address")).toBe("fulladdr");
  });

  it("takes the candidates in order of preference", () => {
    // A layer with both should use the more specific one.
    expect(pickField(["ADDRESS", "SITUS_ADDRESS"], "address")).toBe("SITUS_ADDRESS");
  });

  it("is null rather than a guess when nothing matches", () => {
    // A missing address field must stop an import, not import ten thousand
    // houses with no address.
    expect(pickField(["SHAPE", "GEOM"], "address")).toBeNull();
  });

  it("finds a parcel key and an owner", () => {
    const fields = ["ACCTID", "OWNNAME", "SQFT"];
    expect(pickField(fields, "parcelId")).toBe("ACCTID");
    expect(pickField(fields, "ownerName")).toBe("OWNNAME");
    expect(pickField(fields, "lotSizeSqft")).toBe("SQFT");
  });
});

describe("discoverFields / mappingIsUsable", () => {
  it("maps a realistic Maryland parcel layer", () => {
    const mapping = discoverFields(["OBJECTID", "ACCTID", "SITUS_ADDRESS", "OWNNAME", "SQFT", "SHAPE"]);
    expect(mapping).toEqual({
      parcelId: "ACCTID",
      address: "SITUS_ADDRESS",
      ownerName: "OWNNAME",
      lotSizeSqft: "SQFT",
    });
    expect(mappingIsUsable(mapping)).toBe(true);
  });

  it("is usable without an owner or a lot size, which are extras", () => {
    const mapping = discoverFields(["ACCTID", "ADDRESS"]);
    expect(mapping.ownerName).toBeNull();
    expect(mappingIsUsable(mapping)).toBe(true);
  });

  it("is not usable without an address, which is the identity", () => {
    expect(mappingIsUsable(discoverFields(["OBJECTID", "SHAPE"]))).toBe(false);
  });

  it("survives a county renaming its columns", () => {
    // The reason discovery happens at run time: this should cost a re-run,
    // not a deploy.
    expect(mappingIsUsable(discoverFields(["PARCEL_ID", "PROPADDR", "OWNER_NAME"]))).toBe(true);
  });
});

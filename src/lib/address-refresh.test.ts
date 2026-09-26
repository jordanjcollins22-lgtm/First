import { describe, expect, it } from "vitest";

import {
  ambiguousOnes,
  refreshLabel,
  refreshSummary,
  staleOnes,
  verdictFor,
  type AddressState,
} from "./address-refresh";

function state(over: Partial<AddressState> = {}): AddressState {
  return {
    id: "c1",
    name: "Dana Ruiz",
    importAddress: "12 Oak St, Bel Air, MD 21014",
    propertyAddresses: ["12 Oak St, Bel Air, MD 21014"],
    ...over,
  };
}

describe("verdictFor", () => {
  it("is settled when the property already says what the file says", () => {
    expect(verdictFor(state())).toBe("matches");
  });

  it("ignores the wording the geocoder chose", () => {
    // The placing step writes the geocoder's own phrasing, which is not
    // character-for-character what the file said and never was.
    expect(
      verdictFor(state({ propertyAddresses: ["12 Oak Street, Bel Air, MD 21014"] }))
    ).toBe("matches");
  });

  it("is stale when the one property says something else", () => {
    // The reported bug: the file was corrected, the property was not.
    expect(
      verdictFor(state({ propertyAddresses: ["4100 Ocean Blvd, Ocean City, MD 21842"] }))
    ).toBe("stale");
  });

  it("leaves a contact with several properties for a person to judge", () => {
    expect(
      verdictFor(
        state({ propertyAddresses: ["1 Elm Rd, Fallston, MD", "9 Pine Ct, Forest Hill, MD"] })
      )
    ).toBe("ambiguous");
  });

  it("leaves an unplaced contact to the normal placing step", () => {
    expect(verdictFor(state({ propertyAddresses: [] }))).toBe("unplaced");
  });

  it("has nothing to compare when nothing was imported", () => {
    expect(verdictFor(state({ importAddress: null }))).toBe("nothing_imported");
    expect(verdictFor(state({ importAddress: "   " }))).toBe("nothing_imported");
  });
});

describe("staleOnes and ambiguousOnes", () => {
  const rows = [
    state({ id: "a" }),
    state({ id: "b", propertyAddresses: ["Somewhere else"] }),
    state({ id: "c", propertyAddresses: ["One place", "Another place"] }),
    state({ id: "d", propertyAddresses: [] }),
  ];

  it("picks only the ones that can be corrected without guessing", () => {
    expect(staleOnes(rows).map((r) => r.id)).toEqual(["b"]);
  });

  it("keeps the guesses separate rather than dropping them", () => {
    expect(ambiguousOnes(rows).map((r) => r.id)).toEqual(["c"]);
  });
});

describe("refreshLabel", () => {
  it("says what it will do, and says so in the singular when it is one", () => {
    expect(refreshLabel(0)).toBe("Addresses are up to date");
    expect(refreshLabel(1)).toBe("Re-place 1 corrected address");
    expect(refreshLabel(6)).toBe("Re-place 6 corrected addresses");
  });
});

describe("refreshSummary", () => {
  it("reports what moved", () => {
    expect(refreshSummary({ placed: 4, failed: 0, ambiguous: 0 })).toBe(
      "Moved 4 addresses to where the file says."
    );
  });

  it("does not hide the ones it could not look up", () => {
    expect(refreshSummary({ placed: 2, failed: 1, ambiguous: 0 })).toContain(
      "1 could not be looked up"
    );
  });

  it("says why it left some alone", () => {
    const out = refreshSummary({ placed: 0, failed: 0, ambiguous: 2 });
    expect(out).toContain("2 contacts have more than one property");
  });
});

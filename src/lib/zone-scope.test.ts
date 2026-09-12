import { describe, expect, it } from "vitest";

import {
  displayLabel,
  groupScopeByService,
  looksLikeRawId,
  scopeTextFor,
  scopesForZones,
  serviceLabelFor,
  zoneNeedsScope,
  type ZoneScopeInput,
} from "./zone-scope";

const CUSTOM_ID = "custom-488c16d9-2617-46ea-8635-cb7ce7bd8448";

describe("serviceLabelFor", () => {
  it("uses the built-in label when there is one", () => {
    expect(serviceLabelFor({ label: "Mulch" }, { name: "Something else" })).toBe("Mulch");
  });

  it("falls back to the pricing row for a custom service", () => {
    // The exact bug: a custom service has no built-in definition, and its
    // name was sitting on the pricing row unread.
    expect(serviceLabelFor(undefined, { name: "Crack Weed Removal" })).toBe("Crack Weed Removal");
  });

  it("never returns a uuid", () => {
    expect(serviceLabelFor(undefined, undefined)).toBe("Service");
  });

  it("ignores an empty or blank name", () => {
    expect(serviceLabelFor({ label: "   " }, { name: "Edging" })).toBe("Edging");
    expect(serviceLabelFor(undefined, { name: "  " })).toBe("Service");
  });
});

describe("scopeTextFor", () => {
  it("prefers what somebody typed on the zone", () => {
    const text = scopeTextFor({
      def: { label: "Mulch", autoScope: () => "Generated" },
      pricing: { name: "Mulch", scopeTemplate: "Preset" },
      notes: "Two yards of black mulch, beds only",
    });
    expect(text).toBe("Two yards of black mulch, beds only");
  });

  it("uses the business's preset when the zone says nothing", () => {
    const text = scopeTextFor({
      def: { label: "Mulch", autoScope: () => "Generated" },
      pricing: { name: "Mulch", scopeTemplate: "Preset wording" },
    });
    expect(text).toBe("Preset wording");
  });

  it("falls back to the built-in wording", () => {
    const text = scopeTextFor({
      def: { label: "Mulch", autoScope: (v: Record<string, string>) => `Mulch to ${v.depth} inches` },
      values: { depth: 3 },
    });
    expect(text).toBe("Mulch to 3 inches");
  });

  it("gives a custom service its preset even with no built-in definition", () => {
    const text = scopeTextFor({ pricing: { name: "Crack Weed Removal", scopeTemplate: "Pull and treat" } });
    expect(text).toBe("Pull and treat");
  });

  it("is empty when nothing anywhere says anything", () => {
    expect(scopeTextFor({})).toBe("");
    expect(scopeTextFor({ pricing: { name: "X", scopeTemplate: null } })).toBe("");
  });

  it("treats whitespace as nothing", () => {
    expect(scopeTextFor({ notes: "   ", pricing: { name: "X", scopeTemplate: "Preset" } })).toBe(
      "Preset"
    );
  });

  it("survives an autoScope that throws nothing useful back", () => {
    expect(scopeTextFor({ def: { label: "X", autoScope: () => "" } })).toBe("");
  });
});

describe("zoneNeedsScope", () => {
  it("flags a zone that would print a heading and nothing else", () => {
    expect(zoneNeedsScope({ pricing: { name: "Crack Weed Removal" } })).toBe(true);
  });

  it("is satisfied by a preset", () => {
    expect(zoneNeedsScope({ pricing: { name: "X", scopeTemplate: "Pull and treat" } })).toBe(false);
  });
});

describe("looksLikeRawId", () => {
  it("recognises a generated service id", () => {
    expect(looksLikeRawId(CUSTOM_ID)).toBe(true);
  });

  it("recognises a bare uuid", () => {
    expect(looksLikeRawId("488c16d9-2617-46ea-8635-cb7ce7bd8448")).toBe(true);
  });

  it("leaves real names alone", () => {
    for (const name of ["Mulch", "Crack Weed Removal", "Custom Edging", "Lawn Care"]) {
      expect(looksLikeRawId(name)).toBe(false);
    }
  });
});

describe("displayLabel", () => {
  it("repairs a uuid that already went out on a proposal", () => {
    // Proposals are snapshots, so the broken ones still hold the id until
    // somebody rebuilds them. A client must not see it in the meantime.
    expect(displayLabel(CUSTOM_ID, { name: "Crack Weed Removal" })).toBe("Crack Weed Removal");
  });

  it("falls back to a word rather than showing the id", () => {
    expect(displayLabel(CUSTOM_ID, undefined)).toBe("Service");
  });

  it("leaves a good label untouched", () => {
    expect(displayLabel("Mulch", { name: "Something else" })).toBe("Mulch");
  });
});

/** A zone of one service, with whatever the evaluator answered on it. */
function zone(serviceId: string, extra: Partial<ZoneScopeInput> = {}): ZoneScopeInput {
  return {
    serviceId,
    def: { label: "Lawn Care", autoScope: (() => "Mow, edge, blow off.") as never },
    ...extra,
  };
}

describe("one scope per service, across every area of it", () => {
  it("gives three lawn areas the same paragraph", () => {
    const scopes = scopesForZones([zone("lawn-care"), zone("lawn-care"), zone("lawn-care")]);
    expect(scopes).toEqual(["Mow, edge, blow off.", "Mow, edge, blow off.", "Mow, edge, blow off."]);
  });

  it("keeps different services apart", () => {
    const beds = { def: { label: "Beds", autoScope: (() => "Weed, edge, mulch.") as never } };
    const scopes = scopesForZones([zone("lawn-care"), zone("landscape-bed", beds)]);
    expect(scopes).toEqual(["Mow, edge, blow off.", "Weed, edge, mulch."]);
  });

  it("lets a note on one area stay on that area", () => {
    // The exception the evaluation records: this bed has the fence to work
    // around, and that is true of this bed and no other.
    const scopes = scopesForZones([
      zone("lawn-care"),
      zone("lawn-care", { notes: "Gate is padlocked — the client leaves the key under the pot." }),
      zone("lawn-care"),
    ]);
    expect(scopes[0]).toBe("Mow, edge, blow off.");
    expect(scopes[1]).toBe("Gate is padlocked — the client leaves the key under the pot.");
    expect(scopes[2]).toBe("Mow, edge, blow off.");
  });

  it("does not let one area's note become every area's scope", () => {
    const scopes = scopesForZones([
      zone("lawn-care", { notes: "Watch the sprinkler heads by the drive." }),
      zone("lawn-care"),
    ]);
    expect(scopes[1]).toBe("Mow, edge, blow off.");
  });

  it("uses the business's own wording for the service when it has one", () => {
    const pricing = { name: "Lawn Care", scopeTemplate: "Cut at three inches, every seven days." };
    const scopes = scopesForZones([zone("lawn-care", { pricing }), zone("lawn-care")]);
    // Written once against the service, so it reaches every area of it --
    // including the ones whose own pricing row was not looked up.
    expect(scopes).toEqual([
      "Cut at three inches, every seven days.",
      "Cut at three inches, every seven days.",
    ]);
  });

  it("does not let one oddly answered area rewrite the rest", () => {
    // Four areas say one thing and one says another; the four win.
    const odd = { def: { label: "Lawn Care", autoScope: (() => "Mow only.") as never } };
    const scopes = scopesForZones([
      zone("lawn-care"),
      zone("lawn-care"),
      zone("lawn-care", odd),
      zone("lawn-care"),
    ]);
    expect(scopes.every((s) => s === "Mow, edge, blow off.")).toBe(true);
  });

  it("takes the first when two readings are equally common", () => {
    const other = { def: { label: "Lawn Care", autoScope: (() => "Mow only.") as never } };
    const scopes = scopesForZones([zone("lawn-care"), zone("lawn-care", other)]);
    expect(scopes).toEqual(["Mow, edge, blow off.", "Mow, edge, blow off."]);
  });

  it("leaves a zone with no service to itself", () => {
    const scopes = scopesForZones([
      { serviceId: null, notes: "Odd corner, see photo." },
      { serviceId: null },
      zone("lawn-care"),
    ]);
    expect(scopes).toEqual(["Odd corner, see photo.", "", "Mow, edge, blow off."]);
  });

  it("says nothing rather than something wrong when there is nothing to say", () => {
    expect(scopesForZones([{ serviceId: "lawn-care" }])).toEqual([""]);
  });

  it("gives back nothing for no zones", () => {
    expect(scopesForZones([])).toEqual([]);
  });

  it("agrees with the single-zone answer when there is only one zone", () => {
    const one = zone("lawn-care", { notes: "  " });
    expect(scopesForZones([one])[0]).toBe(scopeTextFor(one));
  });
});

describe("gathering the areas into one row per service", () => {
  it("gives a service one row however many areas it has", () => {
    const groups = groupScopeByService([
      { serviceLabel: "Lawn Care", scopeText: "Mow, edge, blow off." },
      { serviceLabel: "Lawn Care", scopeText: "Mow, edge, blow off." },
      { serviceLabel: "Lawn Care", scopeText: "Mow, edge, blow off." },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].zones).toEqual([0, 1, 2]);
    expect(groups[0].shared).toBe("Mow, edge, blow off.");
    expect(groups[0].exceptions).toEqual([]);
  });

  it("keeps the services in the order they appear", () => {
    const groups = groupScopeByService([
      { serviceLabel: "Lawn Care", scopeText: "a" },
      { serviceLabel: "Beds", scopeText: "b" },
      { serviceLabel: "Lawn Care", scopeText: "a" },
    ]);
    expect(groups.map((g) => g.serviceLabel)).toEqual(["Lawn Care", "Beds"]);
    expect(groups[0].zones).toEqual([0, 2]);
    expect(groups[1].zones).toEqual([1]);
  });

  it("gives an area that says something else a box of its own", () => {
    // Where an evaluator's note about one particular area lives. Folding it
    // into the shared box would throw away the reason it is different.
    const groups = groupScopeByService([
      { serviceLabel: "Beds", scopeText: "Weed, edge, mulch." },
      { serviceLabel: "Beds", scopeText: "Weed, edge, mulch." },
      { serviceLabel: "Beds", scopeText: "Fence panel comes off first." },
    ]);
    expect(groups[0].shared).toBe("Weed, edge, mulch.");
    expect(groups[0].exceptions).toEqual([2]);
  });

  it("treats blank as an answer, so one box fills all the empty ones", () => {
    const groups = groupScopeByService([
      { serviceLabel: "Snow Removal", scopeText: "" },
      { serviceLabel: "Snow Removal", scopeText: "" },
    ]);
    expect(groups[0].shared).toBe("");
    expect(groups[0].exceptions).toEqual([]);
  });

  it("takes the wording most of the areas carry", () => {
    const groups = groupScopeByService([
      { serviceLabel: "Lawn Care", scopeText: "Mow, edge, blow off." },
      { serviceLabel: "Lawn Care", scopeText: "Mow only." },
      { serviceLabel: "Lawn Care", scopeText: "Mow, edge, blow off." },
    ]);
    expect(groups[0].shared).toBe("Mow, edge, blow off.");
    expect(groups[0].exceptions).toEqual([1]);
  });

  it("loses no area", () => {
    const zones = [
      { serviceLabel: "Lawn Care", scopeText: "a" },
      { serviceLabel: "Beds", scopeText: "b" },
      { serviceLabel: "Lawn Care", scopeText: "c" },
      { serviceLabel: "Trimming", scopeText: "" },
    ];
    const covered = groupScopeByService(zones).flatMap((g) => g.zones).sort();
    expect(covered).toEqual([0, 1, 2, 3]);
  });

  it("gives back nothing for no areas", () => {
    expect(groupScopeByService([])).toEqual([]);
  });
});

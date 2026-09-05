import { describe, expect, it } from "vitest";

import {
  displayLabel,
  looksLikeRawId,
  scopeTextFor,
  serviceLabelFor,
  zoneNeedsScope,
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

import { describe, expect, it } from "vitest";

import { readOptions } from "./proposal-options";
import {
  addonFromForm,
  addonLines,
  addonsCents,
  areaPick,
  chosenCents,
  markChosen,
  pickAddons,
  readAddons,
  setAddon,
  withAddons,
  type ProposalAddon,
} from "./proposal-addons";

const lights: ProposalAddon = {
  key: "christmas-lights",
  name: "Christmas lights",
  priceCents: 45000,
  decorate: "Roofline across the front",
  lights: "ours",
  takedown: "included",
  note: "",
};

describe("reading add-ons", () => {
  it("reads nothing from a proposal without any", () => {
    expect(readAddons(null)).toEqual([]);
    expect(readAddons({ options: [] })).toEqual([]);
  });

  it("drops anything without a name or a real price", () => {
    const raw = { addons: [lights, { key: "x", name: "Free", priceCents: 0 }, { key: "y", priceCents: 100 }, "junk"] };
    expect(readAddons(raw).map((a) => a.key)).toEqual(["christmas-lights"]);
  });

  it("leaves the packages working beside it", () => {
    const area = { priceCents: 100 };
    const raw = withAddons(
      { options: [{ key: "a", name: "A", totalCents: 100, areas: [area] }, { key: "b", name: "B", totalCents: 200, areas: [area] }] },
      [lights]
    );
    expect(readOptions(raw, 1)?.options.length).toBe(2);
    expect(readAddons(raw)).toHaveLength(1);
  });

  it("does not make a one-price proposal look like it has packages", () => {
    expect(readOptions(withAddons(null, [lights]), 1)).toBeNull();
  });
});

describe("changing add-ons", () => {
  it("replaces one by key and takes it off with null", () => {
    const changed = setAddon([lights], lights.key, { ...lights, priceCents: 50000 });
    expect(changed).toHaveLength(1);
    expect(changed[0].priceCents).toBe(50000);
    expect(setAddon(changed, lights.key, null)).toEqual([]);
  });

  it("removes the key from the json when none are left", () => {
    expect(withAddons({ addons: [lights], chosen: "a" }, [])).toEqual({ chosen: "a" });
  });
});

describe("the client's choice", () => {
  it("only counts add-ons that are on the proposal", () => {
    const ticked = pickAddons([lights], ["christmas-lights", "made-up"]);
    expect(addonsCents(ticked)).toBe(45000);
    expect(addonsCents(pickAddons([lights], null))).toBe(0);
  });

  it("marks the ticked ones chosen and clears the rest", () => {
    expect(markChosen([lights], ["christmas-lights"])[0].chosen).toBe(true);
    expect(markChosen([{ ...lights, chosen: true }], [])[0].chosen).toBeUndefined();
  });
});

describe("what the client reads", () => {
  it("says only what was set", () => {
    expect(addonLines(lights)).toEqual([
      "We decorate: Roofline across the front",
      "We supply the lights",
      "Takedown after the holidays is included",
    ]);
    expect(addonLines({ ...lights, decorate: "", lights: null, takedown: null })).toEqual([]);
  });
});

describe("the account manager's form", () => {
  const form = { key: "christmas-lights", name: "", price: "$1,250", decorate: " Front bushes ", lights: "theirs", takedown: "", note: "" };

  it("turns into an add-on", () => {
    const made = addonFromForm(form);
    expect(made).toMatchObject({ name: "Christmas lights", priceCents: 125000, decorate: "Front bushes", lights: "theirs", takedown: null });
  });

  it("needs a price", () => {
    expect(addonFromForm({ ...form, price: "" })).toBe("Put a price on it first.");
    expect(addonFromForm({ ...form, price: "abc" })).toBe("Put a price on it first.");
  });
});

describe("areas the client picks from", () => {
  const byArea: ProposalAddon = {
    ...lights,
    decorate: "",
    priceCents: 0,
    areas: [
      { key: "roofline", name: "Roofline", priceCents: 30000 },
      { key: "bushes", name: "Bushes", priceCents: 12000 },
      { key: "front-door", name: "Front door", priceCents: 5000 },
    ],
  };

  it("prices the add-on as every area together and drops bad areas", () => {
    const raw = { addons: [{ ...byArea, areas: [...byArea.areas!, { key: "x", name: "Free", priceCents: 0 }, { key: "a/b", name: "Slash", priceCents: 10 }] }] };
    const [read] = readAddons(raw);
    expect(read.areas?.map((a) => a.key)).toEqual(["roofline", "bushes", "front-door"]);
    expect(read.priceCents).toBe(47000);
  });

  it("adds only the areas the client ticked", () => {
    const [read] = readAddons({ addons: [byArea] });
    const keys = [areaPick("christmas-lights", "roofline"), areaPick("christmas-lights", "front-door"), areaPick("christmas-lights", "made-up")];
    const ticked = pickAddons([read], keys);
    expect(addonsCents(ticked)).toBe(35000);
    expect(ticked[0].areas?.map((a) => a.key)).toEqual(["roofline", "front-door"]);
    // Ticking the add-on's own key does not buy every area.
    expect(pickAddons([read], ["christmas-lights"])).toEqual([]);
  });

  it("marks the ticked areas chosen, and the add-on with them", () => {
    const [read] = readAddons({ addons: [byArea] });
    const [marked] = markChosen([read], [areaPick("christmas-lights", "bushes")]);
    expect(marked.chosen).toBe(true);
    expect(marked.areas?.filter((a) => a.chosen).map((a) => a.key)).toEqual(["bushes"]);
    expect(chosenCents(marked)).toBe(12000);
    expect(addonLines(marked)).toContain("Areas: Bushes");
    const [none] = markChosen([marked], []);
    expect(none.chosen).toBeUndefined();
    expect(chosenCents(none)).toBe(0);
  });

  it("still reads a one-price add-on from before areas", () => {
    expect(chosenCents({ ...lights, chosen: true })).toBe(45000);
    expect(pickAddons([lights], [areaPick("christmas-lights", "roofline")])).toEqual([]);
  });
});

describe("the account manager's area form", () => {
  const base = { key: "christmas-lights", name: "", price: "", decorate: "", lights: "", takedown: "", note: "" };

  it("keeps only the areas with a price", () => {
    const made = addonFromForm({
      ...base,
      areas: [
        { name: "Roofline", price: "$300" },
        { name: "Front trees", price: "" },
        { name: "", price: "" },
        { name: "Bushes", price: "120" },
        { name: "Bushes", price: "80" },
      ],
    });
    expect(made).toMatchObject({
      priceCents: 50000,
      areas: [
        { key: "roofline", name: "Roofline", priceCents: 30000 },
        { key: "bushes", name: "Bushes", priceCents: 12000 },
        { key: "bushes-2", name: "Bushes", priceCents: 8000 },
      ],
    });
  });

  it("needs at least one priced area and a real number", () => {
    expect(addonFromForm({ ...base, areas: [{ name: "Roofline", price: "" }] })).toBe("Put a price on at least one area first.");
    expect(addonFromForm({ ...base, areas: [{ name: "Roofline", price: "abc" }] })).toBe("Check the price for Roofline.");
  });

  it("round-trips through the options json", () => {
    const made = addonFromForm({ ...base, areas: [{ name: "Walkway", price: "150" }] }) as ProposalAddon;
    expect(readAddons(withAddons(null, [made]))).toEqual([made]);
  });
});

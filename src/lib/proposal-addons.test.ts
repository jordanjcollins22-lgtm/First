import { describe, expect, it } from "vitest";

import { readOptions } from "./proposal-options";
import {
  addonFromForm,
  addonLines,
  addonsCents,
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

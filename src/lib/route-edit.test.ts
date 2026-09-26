import { describe, expect, it } from "vitest";

import { idsOnRound, isOnRound, MODE_HINT, MODE_LABEL, toggleHouse, toggleOrder, type EditableHouse, type RoundEdits } from "@/lib/route-edit";

const HOUSES: EditableHouse[] = [
  { id: "a", address: "1 Main", lat: 39.5, lng: -77.0, on: true },
  { id: "b", address: "3 Main", lat: 39.5001, lng: -77.0, on: true },
  { id: "c", address: "5 Main", lat: 39.5002, lng: -77.0, on: false },
  { id: "d", address: "7 Main", lat: 39.5003, lng: -77.0, on: false },
];

function edits(remove: string[] = [], add: string[] = []): RoundEdits {
  return { remove: new Set(remove), add: new Set(add) };
}

describe("isOnRound", () => {
  it("says a door that started on the round is on it", () => {
    expect(isOnRound(HOUSES[0], edits())).toBe(true);
  });

  it("says a door that started off the round is off it", () => {
    expect(isOnRound(HOUSES[2], edits())).toBe(false);
  });

  it("takes a removal into account", () => {
    expect(isOnRound(HOUSES[0], edits(["a"]))).toBe(false);
  });

  it("takes an addition into account", () => {
    expect(isOnRound(HOUSES[2], edits([], ["c"]))).toBe(true);
  });

  it("lets an addition win over a stale removal", () => {
    // Taken off, then put back: on the round, whatever it started as.
    expect(isOnRound(HOUSES[0], edits(["a"], ["a"]))).toBe(true);
  });
});

describe("idsOnRound", () => {
  it("is the round as it stands, not as it arrived", () => {
    expect([...idsOnRound(HOUSES, edits(["a"], ["d"]))].sort()).toEqual(["b", "d"]);
  });

  it("is every door when nothing has been edited and every door is on", () => {
    const all = HOUSES.map((h) => ({ ...h, on: true }));
    expect(idsOnRound(all, edits()).size).toBe(4);
  });

  it("is empty when the round has no doors", () => {
    expect(idsOnRound([], edits()).size).toBe(0);
  });
});

describe("toggleHouse", () => {
  it("takes a door that was on the round out of it", () => {
    const next = toggleHouse(HOUSES, edits(), "a");
    expect([...next.remove]).toEqual(["a"]);
    expect([...next.add]).toEqual([]);
  });

  it("puts a door that was never on the round onto it", () => {
    const next = toggleHouse(HOUSES, edits(), "c");
    expect([...next.add]).toEqual(["c"]);
    expect([...next.remove]).toEqual([]);
  });

  it("forgets an addition rather than recording a removal", () => {
    // Added then tapped again: the round is exactly as it arrived, so the
    // save should have nothing to say about this door.
    const once = toggleHouse(HOUSES, edits(), "c");
    const twice = toggleHouse(HOUSES, once, "c");
    expect(twice.add.size).toBe(0);
    expect(twice.remove.size).toBe(0);
  });

  it("forgets a removal when the door is put back", () => {
    const once = toggleHouse(HOUSES, edits(), "a");
    const twice = toggleHouse(HOUSES, once, "a");
    expect(twice.remove.size).toBe(0);
    expect(twice.add.size).toBe(0);
    expect(isOnRound(HOUSES[0], twice)).toBe(true);
  });

  it("leaves the edits alone when the house is not in the zone", () => {
    const before = edits(["a"]);
    expect(toggleHouse(HOUSES, before, "nowhere")).toBe(before);
  });

  it("does not change the sets it was given", () => {
    const before = edits();
    toggleHouse(HOUSES, before, "a");
    expect(before.remove.size).toBe(0);
  });

  it("keeps other doors' edits", () => {
    const next = toggleHouse(HOUSES, edits(["a"], ["c"]), "b");
    expect([...next.remove].sort()).toEqual(["a", "b"]);
    expect([...next.add]).toEqual(["c"]);
  });
});

describe("toggleOrder", () => {
  it("adds a door to the end of the walk", () => {
    expect(toggleOrder(["a"], "b")).toEqual(["a", "b"]);
  });

  it("takes a door back out without disturbing the rest", () => {
    expect(toggleOrder(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("starts an order from nothing", () => {
    expect(toggleOrder([], "a")).toEqual(["a"]);
  });

  it("does not change the list it was given", () => {
    const before = ["a"];
    toggleOrder(before, "b");
    expect(before).toEqual(["a"]);
  });
});

describe("the modes", () => {
  it("names and explains all three", () => {
    for (const mode of ["pick", "order", "line"] as const) {
      expect(MODE_LABEL[mode].length).toBeGreaterThan(0);
      expect(MODE_HINT[mode].length).toBeGreaterThan(0);
    }
  });

  it("tells the person to look at the map, since that is where the tap goes", () => {
    expect(MODE_HINT.pick).toContain("map");
    expect(MODE_HINT.order).toContain("map");
  });
});

import { describe, expect, it } from "vitest";

import { readCrewMap } from "./crew-map-areas";

describe("readCrewMap", () => {
  it("reads saved areas and turn", () => {
    expect(readCrewMap({ crewMap: { areas: ["front", "sides"], turn: 1 } })).toEqual({ areas: ["front", "sides"], turn: 1 });
  });
  it("is null when nothing is saved or nothing valid is picked", () => {
    expect(readCrewMap(null)).toBeNull();
    expect(readCrewMap({ addons: [] })).toBeNull();
    expect(readCrewMap({ crewMap: { areas: ["whole", "nope"] } })).toBeNull();
  });
  it("keeps the turn between 0 and 3", () => {
    expect(readCrewMap({ crewMap: { areas: ["back"], turn: 5 } })?.turn).toBe(1);
    expect(readCrewMap({ crewMap: { areas: ["back"], turn: "x" } })?.turn).toBe(0);
  });
});

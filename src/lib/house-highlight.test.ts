import { describe, expect, it } from "vitest";

import { countHighlight, HIGHLIGHT_PRESETS, matchesHighlight, stageOwnershipTable, type MatrixRow } from "./house-highlight";
import type { MapPoint } from "./house-geojson";

const clientRenting: MapPoint = [-76.3, 39.5, 4, 2, 0, 1];
const untouchedOwnerWalkableSold: MapPoint = [-76.3, 39.5, 0, 1, 1, 1];
const spokenUnknownOffRoute: MapPoint = [-76.3, 39.5, 1, 0, 0, 0];

describe("matchesHighlight", () => {
  it("answers each preset's question about a point", () => {
    const by = Object.fromEntries(HIGHLIGHT_PRESETS.map((p) => [p.key, p.highlight]));
    expect(matchesHighlight(clientRenting, by["clients-renting"])).toBe(true);
    expect(matchesHighlight(clientRenting, by["clients-owning"])).toBe(false);
    expect(matchesHighlight(untouchedOwnerWalkableSold, by["hanger-targets"])).toBe(true);
    expect(matchesHighlight(untouchedOwnerWalkableSold, by["new-owners-untouched"])).toBe(true);
    expect(matchesHighlight(spokenUnknownOffRoute, by["talked-renting"])).toBe(false);
    expect(matchesHighlight(clientRenting, by["clients-off-route"])).toBe(false);
  });
  it("asks about the kind of door", () => {
    const apartmentClient: MapPoint = [-76.3, 39.5, 4, 2, 0, 1, 4];
    expect(matchesHighlight(apartmentClient, { kinds: [3, 4] })).toBe(true);
    expect(matchesHighlight(apartmentClient, { kinds: [5] })).toBe(false);
    expect(matchesHighlight(clientRenting, { kinds: [4] })).toBe(false);
  });
  it("keeps everything with no question asked, and tolerates old three-number points", () => {
    expect(matchesHighlight(clientRenting, null)).toBe(true);
    expect(matchesHighlight([-76.3, 39.5, 4], { stages: [4] })).toBe(true);
    expect(matchesHighlight([-76.3, 39.5, 4], { ownership: [1] })).toBe(false);
  });
});

describe("the counted matrix", () => {
  const rows: MatrixRow[] = [
    [0, 1, 1, 50000],
    [0, 2, 1, 9000],
    [0, 0, 0, 20000],
    [4, 1, 1, 40],
    [4, 2, 0, 12],
    [5, 1, 0, 20],
  ];
  it("counts a question the same way the map filters it", () => {
    expect(countHighlight(rows, { stages: [4, 5], ownership: [2] })).toBe(12);
    expect(countHighlight(rows, { stages: [0], ownership: [1], walkableRoute: true })).toBe(50000);
    expect(countHighlight(rows, { stages: [4, 5], walkableRoute: false })).toBe(32);
  });
  it("lays the stages against ownership, skipping empty stages", () => {
    const table = stageOwnershipTable(rows);
    expect(table.map((r) => r.label)).toEqual(["Not spoken to", "Client", "Work completed"]);
    expect(table[1]).toMatchObject({ owner: 40, absentee: 12, unknown: 0, total: 52 });
  });
});

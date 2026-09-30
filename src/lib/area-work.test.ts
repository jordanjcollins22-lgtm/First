import { describe, expect, it } from "vitest";

import { allPrepped, areaNeeds, boardState, canTick, pickKits, stepsFor, tipsFor } from "./area-work";

const tools = [
  { id: "shovel", name: "Shovel", kits: [1] },
  { id: "edger", name: "Edger", kits: [1, 2] },
  { id: "blower", name: "Blower", kits: [] },
  { id: "trimmer", name: "Hedge trimmer", kits: [3] },
];
const links = [
  { service_type_id: "landscape-bed", tool_id: "shovel" },
  { service_type_id: "landscape-bed", tool_id: "blower" },
  { service_type_id: "trimming", tool_id: "trimmer" },
  { service_type_id: "lawn-care", tool_id: "edger" },
];

describe("steps and tips", () => {
  it("gives every service a prep, a work and a clean up phase", () => {
    for (const id of ["landscape-bed", "trimming", "something-custom"]) {
      const phases = new Set(stepsFor(id).map((s) => s.phase));
      expect([...phases]).toEqual(["prep", "work", "cleanup"]);
    }
  });

  it("tells the bed crew about mulch depth and edging", () => {
    const titles = tipsFor("landscape-bed").map((t) => t.title);
    expect(titles).toEqual(expect.arrayContaining(["Mulch too high", "Mulch too thin", "On the grass", "How to dig an edge"]));
  });

  it("uses no dashes a client could read as an em dash", () => {
    for (const id of ["landscape-bed", "trimming", "lawn-care", "x"]) {
      for (const text of [...stepsFor(id).map((s) => s.label), ...tipsFor(id).map((t) => t.body)]) expect(text).not.toMatch(/[—–]/);
    }
  });
});

describe("kits", () => {
  it("lists the tools and which kits hold them", () => {
    expect(areaNeeds("landscape-bed", links, tools)).toEqual({ tools: ["Blower", "Shovel"], kitChoices: [[1]] });
  });

  it("takes a free kit, and waits when the only kit is elsewhere", () => {
    const needs = areaNeeds("landscape-bed", links, tools);
    expect(pickKits(needs, new Set(), new Set())).toEqual({ ok: true, kits: [1] });
    expect(pickKits(needs, new Set(), new Set([1]))).toEqual({ ok: false, waitingOn: [1] });
    // Joining an area that already has the kit is always fine.
    expect(pickKits(needs, new Set([1]), new Set())).toEqual({ ok: true, kits: [1] });
  });

  it("falls back to another kit holding the same tool", () => {
    const needs = areaNeeds("lawn-care", links, tools);
    expect(pickKits(needs, new Set(), new Set([1]))).toEqual({ ok: true, kits: [2] });
  });
});

describe("the board", () => {
  const zones = [
    { id: "a", name: "Front bed", serviceTypeId: "landscape-bed" },
    { id: "b", name: "Side bed", serviceTypeId: "landscape-bed" },
    { id: "c", name: "Hedges", serviceTypeId: "trimming" },
  ];
  const needs = new Map(zones.map((z) => [z.id, areaNeeds(z.serviceTypeId, links, tools)]));

  it("holds the second bed until kit 1 comes back, and says where it is", () => {
    const board = boardState({
      zones,
      needs,
      working: [{ zoneId: "a", profileId: "p1", name: "Jake", kits: [1] }],
      ticked: new Map(),
      photos: [],
    });
    expect(board.map((a) => a.status)).toEqual(["working", "waiting", "open"]);
    expect(board[1].waitingReason).toBe("Needs kit 1, in use in Front bed.");
    expect(board[2].wouldTake).toEqual([3]);
  });

  it("frees the kit once the area has its after photo, even if nobody left it", () => {
    const board = boardState({
      zones,
      needs,
      working: [{ zoneId: "a", profileId: "p1", name: "Jake", kits: [1] }],
      ticked: new Map(),
      photos: [{ zoneId: "a", kind: "after" }],
    });
    expect(board.map((a) => a.status)).toEqual(["done", "open", "open"]);
  });

  it("asks for the during photo when prep is done, and the after when everything is", () => {
    const prep = new Set(stepsFor("landscape-bed").filter((s) => s.phase === "prep").map((s) => s.key));
    const all = new Set(stepsFor("landscape-bed").map((s) => s.key));
    const mid = boardState({ zones, needs, working: [], ticked: new Map([["a", prep]]), photos: [] });
    expect(mid[0].photoDue).toBe("during");
    const end = boardState({ zones, needs, working: [], ticked: new Map([["a", all]]), photos: [{ zoneId: "a", kind: "during" }] });
    expect(end[0].photoDue).toBe("after");
  });
});

describe("canTick", () => {
  const list = stepsFor("landscape-bed");
  const prep = new Set(list.filter((s) => s.phase === "prep").map((s) => s.key));
  const work = list.find((s) => s.phase === "work")!;

  it("holds the work until the prep is done and the during photo is in", () => {
    expect(canTick(work, list, new Set(), false).ok).toBe(false);
    expect(canTick(work, list, prep, false)).toEqual({ ok: false, reason: "Take the prep photo first: prep is done." });
    expect(canTick(work, list, prep, true).ok).toBe(true);
  });

  it("holds every area's work until every area is prepped", () => {
    expect(canTick(work, list, prep, true, false)).toEqual({ ok: false, reason: "Every area gets prepped first. Prep the next area." });
    expect(canTick(list[0], list, new Set(), false, false).ok).toBe(true);
  });
});

describe("the area's own steps", () => {
  it("are its scope, phase by phase, when the answers are there", () => {
    const own = stepsFor("landscape-cleanup", { cleanupType: "General" });
    expect(own[0]).toEqual({ key: "prep-1", label: "Remove all the leaves, sticks and any debris.", phase: "prep" });
    expect(own.at(-1)?.phase).toBe("cleanup");
  });

  it("counts an area prepped once its prep is ticked and its prep photo is in", () => {
    const zones = [{ id: "a", name: "Bed", serviceTypeId: "landscape-bed", values: { material: "Mulch" } }];
    const prep = new Set(stepsFor("landscape-bed", { material: "Mulch" }).filter((s) => s.phase === "prep").map((s) => s.key));
    const needs = new Map([["a", { tools: [], kitChoices: [] }]]);
    const before = boardState({ zones, needs, working: [], ticked: new Map([["a", prep]]), photos: [] });
    const after = boardState({ zones, needs, working: [], ticked: new Map([["a", prep]]), photos: [{ zoneId: "a", kind: "during" }] });
    expect(allPrepped(before)).toBe(false);
    expect(allPrepped(after)).toBe(true);
  });
});

describe("lawn care that brings ground back to grass", () => {
  const rick = { frequency: "One-time", serviceType: "Aeration", lawnCondition: "Poor", specialInstructions: "Client is looking for aeration and overseeding to return backyard back to grass" };

  it("clears and smooths the dirt, aerates with the rental and seeds, with nothing about mowing or clippings", () => {
    const labels = stepsFor("lawn-care", rick).map((s) => `${s.phase}: ${s.label}`);
    expect(labels).toEqual([
      "prep: Walk the whole area and rake out all the rocks, sticks and any other debris, levelling it out and leaving the whole area smooth.",
      "work: Run the aerator (the rental from Home Depot) over the whole area.",
      "work: Seed the whole area with the seeder.",
      "cleanup: Blow the dirt and seed off the walks and driveway, and load the rocks and debris.",
    ]);
    expect(labels.join(" ")).not.toMatch(/clipping|mow|lawn/i);
  });

  it("aerates without seeding when nobody asked for seed, and seeds for an overseed", () => {
    expect(stepsFor("lawn-care", { serviceType: "Aeration" }).some((s) => /seed/i.test(s.label))).toBe(false);
    expect(stepsFor("lawn-care", { serviceType: "Overseeding" }).map((s) => s.label)).toContain("Seed the whole area with the seeder.");
  });

  it("only talks about clippings when there was mowing", () => {
    expect(stepsFor("lawn-care", { serviceType: "Mowing" }).at(-1)?.label).toMatch(/clippings/);
    expect(stepsFor("lawn-care", { serviceType: "Fertilization" }).at(-1)?.label).toBe("Blow off the walks and driveway.");
  });
});

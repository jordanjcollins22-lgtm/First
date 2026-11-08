import { describe, expect, it } from "vitest";
import * as turf from "@turf/turf";

import {
  applyStepEdits,
  areaAt,
  areaSize,
  areaWork,
  cameraFor,
  cleanModel,
  defaultSteps,
  feetBetween,
  moveStep,
  parseSuggestions,
  placeUnplaced,
  plantLayers,
  plantShape,
  removalCross,
  stepEditsOf,
  stepPath,
  stepPins,
  STEP_KINDS,
  walkOrder,
  type ModelArea,
  type ModelPlant,
} from "@/lib/job-model";
import { SAMPLE_AREAS, SAMPLE_PLANTS, SAMPLE_TRUCK } from "@/lib/job-model-sample";
import { boardToGround, groundToBoard, type ImageGeo } from "@/lib/lot-map";

const plant = (over: Partial<ModelPlant> = {}): ModelPlant => ({
  id: "p",
  name: "Boxwood",
  status: "keep",
  heightFt: 4,
  spreadFt: 6,
  areaId: null,
  at: [-76.34, 39.53],
  ...over,
});

describe("plant geometry", () => {
  it("draws three rings at true scale, widest at the bottom", () => {
    const shapes = plantShape(plant());
    expect(shapes).toHaveLength(3);
    // The bottom ring is the spread across: 6 ft, so 3 ft from the middle.
    const edge = shapes[0].geometry.coordinates[0][0] as [number, number];
    expect(feetBetween([-76.34, 39.53], edge)).toBeCloseTo(3, 1);
    // Heights in metres, topping out at the plant's height.
    expect(shapes[0].properties!.base).toBe(0);
    expect(shapes[2].properties!.height).toBeCloseTo(4 * 0.3048, 2);
    const radii = shapes.map((s) => feetBetween([-76.34, 39.53], s.geometry.coordinates[0][0] as [number, number]));
    expect(radii[0]).toBeGreaterThan(radii[1]);
    expect(radii[1]).toBeGreaterThan(radii[2]);
  });

  it("colours by status and draws nothing for an unplaced plant", () => {
    expect(plantShape(plant({ status: "remove" }))[0].properties!.color).toBe("#dc2626");
    expect(plantShape(plant({ at: null }))).toEqual([]);
  });

  it("crosses out only the plants coming out", () => {
    expect(removalCross(plant())).toBeNull();
    const x = removalCross(plant({ status: "remove" }))!;
    expect(x.geometry.coordinates).toHaveLength(2);
    const layers = plantLayers([plant({ id: "a" }), plant({ id: "b", status: "remove" }), plant({ id: "c", at: null })]);
    expect(layers.shapes.features).toHaveLength(6);
    expect(layers.crosses.features).toHaveLength(1);
    expect(layers.labels.features).toHaveLength(2);
  });

  it("puts photo plants in their bed's middle, spread out, and leaves bedless ones unplaced", () => {
    const placed = placeUnplaced(
      [plant({ id: "a", at: null, areaId: "front-bed" }), plant({ id: "b", at: null, areaId: "front-bed" }), plant({ id: "c", at: null })],
      SAMPLE_AREAS
    );
    expect(placed[0].at).not.toBeNull();
    expect(placed[1].at).not.toBeNull();
    expect(feetBetween(placed[0].at!, placed[1].at!)).toBeGreaterThan(2);
    expect(areaAt(placed[0].at!, SAMPLE_AREAS)).toBe("front-bed");
    expect(areaAt(placed[1].at!, SAMPLE_AREAS)).toBe("front-bed");
    expect(placed[2].at).toBeNull();
  });
});

describe("areas", () => {
  it("measures an outline in square feet and feet around", () => {
    const { sqft, perimeterFt } = areaSize(SAMPLE_AREAS[2]);
    // 6 ft by 32 ft.
    expect(sqft).toBeGreaterThan(180);
    expect(sqft).toBeLessThan(205);
    expect(perimeterFt).toBeGreaterThan(70);
    expect(perimeterFt).toBeLessThan(80);
  });

  it("falls back to the measured size with no outline", () => {
    expect(areaSize({ ...SAMPLE_AREAS[0], ring: [], areaSqFt: 120, perimeterFt: 50 })).toEqual({ sqft: 120, perimeterFt: 50 });
  });
});

describe("the site map's areas on the ground", () => {
  it("round-trips a board point through the ground", () => {
    const geo: ImageGeo = { lng: -76.34, lat: 39.53, zoom: 19.6, bearing: 25, request: 1280, kept: 1200 };
    const image = { x: 512, y: 384, scale: 0.6, rotation: 12, elementWidth: 2560 };
    const ground = boardToGround({ x: 300, y: 200 }, geo, image);
    const back = groundToBoard(ground, geo, image);
    expect(back.x).toBeCloseTo(300, 6);
    expect(back.y).toBeCloseTo(200, 6);
    // The photo's middle is the map's centre.
    const middle = boardToGround({ x: 512, y: 384 }, geo, image);
    expect(middle[0]).toBeCloseTo(-76.34, 8);
    expect(middle[1]).toBeCloseTo(39.53, 8);
  });
});

describe("the order of work", () => {
  const steps = defaultSteps(SAMPLE_AREAS, SAMPLE_PLANTS, SAMPLE_TRUCK);

  it("goes walkthrough, setup, the work in a landscaping order, cleanup, inspection", () => {
    expect(steps[0].kind).toBe("walkthrough");
    expect(steps[1].kind).toBe("setup");
    expect(steps.at(-2)!.kind).toBe("cleanup");
    expect(steps.at(-1)!.kind).toBe("inspect");
    const rank = steps.map((s) => STEP_KINDS.indexOf(s.kind));
    expect([...rank].sort((a, b) => a - b)).toEqual(rank);
    const kinds = new Set(steps.map((s) => s.kind));
    for (const k of ["remove", "weed", "edge", "fabric", "plant", "mulch"] as const) expect(kinds.has(k)).toBe(true);
  });

  it("does each kind of work nearest the truck first", () => {
    // The rock bed is beside the driveway, where the truck is.
    expect(walkOrder(SAMPLE_AREAS, SAMPLE_TRUCK)[0].id).toBe("drive-bed");
    const removes = steps.filter((s) => s.kind === "remove").map((s) => s.areaId);
    expect(removes[0]).toBe("drive-bed");
  });

  it("starts each area at its corner nearest the truck, just inside the bed", () => {
    const edge = steps.find((s) => s.id === "edge:front-bed")!;
    expect(areaAt(edge.at!, SAMPLE_AREAS)).toBe("front-bed");
    const ring = SAMPLE_AREAS[0].ring;
    const nearest = Math.min(...ring.map((p) => feetBetween(p, SAMPLE_TRUCK)));
    expect(feetBetween(edge.at!, SAMPLE_TRUCK)).toBeLessThan(nearest + 3);
  });

  it("names the plants coming out and going in", () => {
    const remove = steps.find((s) => s.id === "remove:front-bed")!;
    expect(remove.title).toContain("Overgrown yew");
    const plantStep = steps.find((s) => s.id === "plant:front-bed")!;
    expect(plantStep.title).toContain("2 × Limelight hydrangea");
    expect(steps.find((s) => s.id === "mulch:front-bed")!.tools).toContain("Mulch (brown)");
  });

  it("only lays fabric under rock and only edges what needs it", () => {
    expect(steps.some((s) => s.id === "fabric:drive-bed")).toBe(true);
    expect(steps.some((s) => s.id === "fabric:front-bed")).toBe(false);
    expect(steps.some((s) => s.id === "edge:drive-bed")).toBe(false);
  });

  it("adds a removal step for a red plant even when the site map didn't ask for one", () => {
    const area: ModelArea = { ...SAMPLE_AREAS[1], values: { bedWork: "Renewal", material: "Mulch" } };
    const kinds = areaWork(area, [plant({ status: "remove", areaId: area.id })]).map((w) => w.kind);
    expect(kinds).toContain("remove");
    expect(areaWork(area, []).map((w) => w.kind)).not.toContain("remove");
  });

  it("still makes a plan with no truck spot", () => {
    const plan = defaultSteps(SAMPLE_AREAS, SAMPLE_PLANTS, null);
    expect(plan[0].at).not.toBeNull();
    expect(plan.length).toBe(steps.length);
  });
});

describe("the office's edits", () => {
  const defaults = defaultSteps(SAMPLE_AREAS, SAMPLE_PLANTS, SAMPLE_TRUCK);

  it("keeps the office's order and changes", () => {
    const moved = moveStep(defaults, 5, 2).map((s, i) => (i === 2 ? { ...s, minutes: 99, title: "Do this first" } : s));
    const edits = stepEditsOf(moved, defaults);
    expect(edits[2]).toEqual({ id: moved[2].id, title: "Do this first", minutes: 99 });
    expect(edits[0]).toEqual({ id: defaults[0].id });
    expect(applyStepEdits(defaults, edits)).toEqual(moved);
  });

  it("slots new work in after the step it follows by default, and drops work that is gone", () => {
    const withoutPlanting = defaults.filter((s) => s.id !== "plant:front-bed");
    const edits = stepEditsOf(moveStep(withoutPlanting, 0, 1), withoutPlanting);
    edits.push({ id: "gone:nowhere" });
    const merged = applyStepEdits(defaults, edits);
    expect(merged.some((s) => s.id === "gone:nowhere")).toBe(false);
    const i = merged.findIndex((s) => s.id === "plant:front-bed");
    const before = defaults[defaults.findIndex((s) => s.id === "plant:front-bed") - 1].id;
    expect(merged[i - 1].id).toBe(before);
    expect(merged[0].kind).toBe("setup");
    expect(merged).toHaveLength(defaults.length);
  });

  it("uses the defaults when nothing was saved", () => {
    expect(applyStepEdits(defaults, [])).toBe(defaults);
  });
});

describe("pins, path and camera", () => {
  const steps = defaultSteps(SAMPLE_AREAS, SAMPLE_PLANTS, SAMPLE_TRUCK);

  it("shares one pin between steps at the same spot", () => {
    const pins = stepPins(steps);
    // The truck: walkthrough and setup, then cleanup and inspection at the end.
    expect(pins[0].numbers).toEqual([1, 2, steps.length - 1, steps.length]);
    expect(pins.flatMap((p) => p.numbers).sort((a, b) => a - b)).toEqual(steps.map((_, i) => i + 1));
  });

  it("draws a path without standing still", () => {
    const path = stepPath(steps)!;
    const coords = path.geometry.coordinates;
    for (let i = 1; i < coords.length; i++) expect(turf.distance(coords[i - 1], coords[i], { units: "feet" })).toBeGreaterThan(1);
  });

  it("looks the way the crew walk", () => {
    const i = steps.findIndex((s, j) => j > 1 && s.areaId);
    const cam = cameraFor(steps, i, 0)!;
    const expected = (turf.bearing(steps[i - 1].at!, steps[i].at!) + 360) % 360;
    expect(cam.bearing).toBe(Math.round(expected));
    expect(cam.pitch).toBeGreaterThan(45);
    expect(cameraFor(steps, 0, 33)!.bearing).toBe(33);
  });
});

describe("saved models and suggestions", () => {
  it("cleans what is saved", () => {
    const m = cleanModel({
      plants: [
        { id: "a", name: " Holly ", status: "weird", heightFt: 500, spreadFt: -1, at: [1, 2] },
        { id: "", name: "x" },
        { id: "b", name: "Rose", status: "new", heightFt: "3", spreadFt: 2, at: [999, 2], areaId: "front-bed" },
      ],
      steps: [{ id: "edge:a", minutes: 12.4, tools: ["Edger", 3] }, { nope: 1 }],
      truck: [-76.3, 39.5],
      videoUrl: "javascript:alert(1)",
    });
    expect(m.plants).toEqual([
      { id: "a", name: "Holly", status: "keep", heightFt: 40, spreadFt: 3, areaId: null, at: [1, 2] },
      { id: "b", name: "Rose", status: "new", heightFt: 3, spreadFt: 2, areaId: "front-bed", at: null },
    ]);
    expect(m.steps).toEqual([{ id: "edge:a", minutes: 12, tools: ["Edger"] }]);
    expect(m.truck).toEqual([-76.3, 39.5]);
    expect(m.videoUrl).toBeNull();
    expect(cleanModel(null)).toEqual({ plants: [], steps: [], truck: null, videoUrl: null });
  });

  it("reads Claude's suggestions", () => {
    const raw = JSON.stringify({
      plants: [
        { name: "Yew", status: "remove", heightFt: 6, spreadFt: 7, areaId: "front-bed", why: "Overgrown, blocking the window" },
        { name: "Boxwood", status: "keep", heightFt: 0, spreadFt: 2, areaId: "unknown", why: "" },
        { name: "", status: "keep", heightFt: 1, spreadFt: 1, areaId: "front-bed", why: "" },
      ],
    });
    expect(parseSuggestions(raw, ["front-bed"])).toEqual([
      { name: "Yew", status: "remove", heightFt: 6, spreadFt: 7, areaId: "front-bed", why: "Overgrown, blocking the window" },
      { name: "Boxwood", status: "keep", heightFt: 3, spreadFt: 2, areaId: null, why: "" },
    ]);
    expect(parseSuggestions("not json", [])).toEqual([]);
  });
});

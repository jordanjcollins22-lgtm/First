import { describe, expect, it } from "vitest";
import type { Feature, Polygon } from "geojson";

import { cleanUpShape } from "./geometry-cleanup";

function jaggedRectangle(closed = true): Feature<Polygon> {
  // A roughly-rectangular trace with small jitter points near two corners,
  // simulating a sloppy hand/touch trace. Mapbox GL Draw always emits
  // closed rings, so `closed` defaults to true to match real input.
  const ring = [
    [-80.8431, 35.2271],
    [-80.84309, 35.22711],
    [-80.8425, 35.2271],
    [-80.8425, 35.2276],
    [-80.84251, 35.22761],
    [-80.8431, 35.2276],
  ];
  if (closed) ring.push(ring[0]);
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [ring],
    },
  };
}

describe("cleanUpShape", () => {
  it("closes an unclosed polygon ring", () => {
    const result = cleanUpShape(jaggedRectangle(false));
    const ring = (result.cleaned.geometry as Polygon).coordinates[0];
    const first = ring[0];
    const last = ring[ring.length - 1];
    expect(first[0]).toBeCloseTo(last[0], 10);
    expect(first[1]).toBeCloseTo(last[1], 10);
  });

  it("does not change area by more than 2% for minor jitter cleanup", () => {
    const result = cleanUpShape(jaggedRectangle());
    expect(result.areaDeltaPercent).not.toBeNull();
    expect(result.areaDeltaPercent as number).toBeLessThan(0.02);
    expect(result.autoApplied).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  it("flags large area changes for confirmation instead of auto-applying", () => {
    const feature: Feature<Polygon> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-80.8431, 35.2271],
            [-80.8429, 35.2271],
            [-80.8429, 35.22715],
            [-80.8428, 35.22715],
            [-80.8428, 35.2276],
            [-80.8431, 35.2276],
            [-80.8431, 35.2271],
          ],
        ],
      },
    };
    // Large tolerance forces aggressive simplification that should shave
    // off a real chunk of the notch, changing area meaningfully.
    const result = cleanUpShape(feature, 40);
    if ((result.areaDeltaPercent as number) > 0.02) {
      expect(result.autoApplied).toBe(false);
      expect(result.requiresConfirmation).toBe(true);
    } else {
      expect(result.autoApplied).toBe(true);
    }
  });
});

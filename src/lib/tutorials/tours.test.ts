import { describe, expect, it } from "vitest";

import { TOURS } from "@/lib/tutorials";
import { MAX_TOUR_STEPS } from "@/lib/tutorials/types";

/**
 * The owner's rule: if a role can't be taught in a short tutorial, the role
 * is too complicated. Every role has one, and none runs long.
 */
describe("first-open tutorials", () => {
  for (const [role, tour] of Object.entries(TOURS)) {
    it(`${role} has a short tutorial`, () => {
      expect(tour.steps.length, role).toBeGreaterThan(0);
      expect(tour.steps.length, role).toBeLessThanOrEqual(MAX_TOUR_STEPS);
      for (const s of tour.steps) {
        expect(s.title.length, s.title).toBeLessThanOrEqual(40);
        expect(s.body.split(/\s+/).length, s.title).toBeLessThanOrEqual(40);
      }
    });
  }
});

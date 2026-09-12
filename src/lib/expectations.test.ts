import { describe, expect, it } from "vitest";

import { EVALUATOR_BRIEFING, EXPECTATIONS, expectationsFor } from "@/lib/expectations";

function area(serviceLabel: string, scopeText = "") {
  return { serviceLabel, scopeText };
}

describe("expectationsFor", () => {
  it("finds the seed expectation from the scope text, not the service name", () => {
    // "Lawn Restoration" says nothing about seed. Its scope text does.
    const found = expectationsFor([
      area("Lawn Restoration", "Surface preparation, topsoil as required, grading, seed installation, and cleanup."),
    ]);
    expect(found.map((e) => e.heading)).toContain("Seed comes up on the weather's schedule, not ours");
  });

  it("picks up a custom service nobody wired up", () => {
    const found = expectationsFor([area("Spring Sod Install", "")]);
    expect(found.map((e) => e.heading)).toContain("New sod knits down, it does not arrive finished");
  });

  it("says nothing about planting on a job with no planting in it", () => {
    const found = expectationsFor([area("Soft Washing", "House siding, moderate buildup.")]);
    expect(found.map((e) => e.heading)).toEqual(["Washing lifts what is on the surface"]);
  });

  it("explains each thing once however many areas it covers", () => {
    // Three seeded areas on one property is still one thing to explain.
    const found = expectationsFor([
      area("Lawn Restoration", "seed installation"),
      area("Lawn Restoration", "seed installation"),
      area("Lawn Restoration", "seed installation"),
    ]);
    expect(found.filter((e) => /Seed comes up/.test(e.heading))).toHaveLength(1);
  });

  it("reads the same way whichever order the areas were drawn in", () => {
    const forwards = expectationsFor([area("Lawn Restoration", "seed"), area("Plant Installation")]);
    const backwards = expectationsFor([area("Plant Installation"), area("Lawn Restoration", "seed")]);
    expect(forwards.map((e) => e.heading)).toEqual(backwards.map((e) => e.heading));
  });

  it("has nothing to say about an empty proposal", () => {
    expect(expectationsFor([])).toEqual([]);
    expect(expectationsFor([area("", "")])).toEqual([]);
  });

  it("covers a whole-property job with several kinds of work", () => {
    const found = expectationsFor([
      area("Landscape Bed", "Bed preparation, weeding, edging, and mulch installation."),
      area("Plant Installation", "Installation of selected plants."),
      area("Lawn Care", "Core aeration to relieve soil compaction."),
    ]);
    const headings = found.map((e) => e.heading);
    expect(headings).toContain("Fresh mulch fades, and beds are never weed free");
    expect(headings).toContain("New plants spend their first year on roots");
    expect(headings).toContain("Aeration looks worse before it looks better");
  });
});

describe("every expectation", () => {
  it("gives a timeframe, because 'it takes a while' is a hedge", () => {
    for (const expectation of EXPECTATIONS) {
      expect(expectation.timeframe.trim().length).toBeGreaterThan(0);
    }
  });

  it("says what will happen without blaming the weather for our work", () => {
    for (const expectation of EXPECTATIONS) {
      expect(expectation.body.trim().length).toBeGreaterThan(80);
      expect(expectation.heading.trim().length).toBeGreaterThan(0);
    }
  });

  it("asks the client for something wherever their part decides the outcome", () => {
    // Watering is the single biggest reason new planting fails and it is
    // entirely theirs to do. Any expectation about something living has to
    // say so, or it is an excuse rather than an expectation.
    const living = EXPECTATIONS.filter((e) => /sod|seed|plant/i.test(e.heading));
    expect(living.length).toBeGreaterThan(0);
    for (const expectation of living) {
      expect(expectation.theirPart, expectation.heading).toBeTruthy();
    }
  });

  it("is written without dashes, like the rest of what a client reads", () => {
    for (const expectation of EXPECTATIONS) {
      expect(`${expectation.heading} ${expectation.body}`).not.toMatch(/—|--/);
    }
  });
});

describe("the evaluator briefing", () => {
  it("gives something to say, not only a rule to follow", () => {
    // An evaluator handed a policy improvises around it. One handed a
    // sentence uses the sentence.
    for (const point of EVALUATOR_BRIEFING) {
      expect(point.say.trim().length, point.heading).toBeGreaterThan(30);
      expect(point.why.trim().length, point.heading).toBeGreaterThan(30);
    }
  });

  it("ends by checking it landed rather than by checking it was said", () => {
    const last = EVALUATOR_BRIEFING[EVALUATOR_BRIEFING.length - 1];
    expect(last.say).toMatch(/\?$/);
  });
});

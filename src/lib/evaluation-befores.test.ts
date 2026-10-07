import { describe, expect, it } from "vitest";

import {
  beforesFromZones,
  destPathFor,
  notYetAdopted,
  type ZoneLike,
} from "@/lib/evaluation-befores";

const JOB = "job-1";

function zone(id: string, photos: string[] | null, withService = true): ZoneLike {
  return {
    id,
    name: `Zone ${id}`,
    service: withService ? { photos } : null,
  };
}

describe("where a photo lands", () => {
  it("keeps the file's own name", () => {
    expect(destPathFor(JOB, "job-1/zone-photos/abc.jpg")).toBe("job-1/from-evaluation/abc.jpg");
  });

  it("gives the same answer twice", () => {
    // Submitting an evaluation, correcting it and submitting again must not
    // put every photo in three times.
    const first = destPathFor(JOB, "job-1/zone-photos/abc.jpg");
    expect(destPathFor(JOB, "job-1/zone-photos/abc.jpg")).toBe(first);
  });

  it("copes with a path that has no folders in it", () => {
    expect(destPathFor(JOB, "abc.jpg")).toBe("job-1/from-evaluation/abc.jpg");
  });
});

describe("which photos become befores", () => {
  it("takes every photo on every finished zone", () => {
    const found = beforesFromZones(JOB, [zone("a", ["p/1.jpg", "p/2.jpg"]), zone("b", ["p/3.jpg"])]);
    expect(found.map((c) => c.sourcePath)).toEqual(["p/1.jpg", "p/2.jpg", "p/3.jpg"]);
  });

  it("keeps the zone with the photo", () => {
    // Before and after only pair within a zone, so the zone has to travel
    // with the picture.
    const found = beforesFromZones(JOB, [zone("a", ["p/1.jpg"])]);
    expect(found[0]).toMatchObject({ zoneId: "a", zoneName: "Zone a" });
  });

  it("ignores a shape with no service on it", () => {
    // A shape somebody drew and never said what it was for is a draft.
    expect(beforesFromZones(JOB, [zone("a", ["p/1.jpg"], false)])).toEqual([]);
  });

  it("takes one photo once even when it is filed under two zones", () => {
    const found = beforesFromZones(JOB, [zone("a", ["p/1.jpg"]), zone("b", ["p/1.jpg"])]);
    expect(found).toHaveLength(1);
    expect(found[0].zoneId).toBe("a");
  });

  it("copes with a zone that has no photos", () => {
    expect(beforesFromZones(JOB, [zone("a", null), zone("b", [])])).toEqual([]);
  });
});

describe("not doing it twice", () => {
  const candidates = beforesFromZones(JOB, [zone("a", ["p/1.jpg", "p/2.jpg"])]);

  it("skips the ones already there", () => {
    const left = notYetAdopted(candidates, ["job-1/from-evaluation/1.jpg"]);
    expect(left.map((c) => c.sourcePath)).toEqual(["p/2.jpg"]);
  });

  it("leaves everything when nothing is there", () => {
    expect(notYetAdopted(candidates, [])).toHaveLength(2);
  });

  it("finds nothing left when they are all there", () => {
    expect(notYetAdopted(candidates, candidates.map((c) => c.destPath))).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";

import { decodeReview, encodeReview } from "./review-link";

describe("review links", () => {
  it("round-trips a checklist", () => {
    const list = { title: "Crew zones", steps: [{ step: "A full area", how: "Look at area 1", path: "/practice/crew#area-full" }] };
    expect(decodeReview(encodeReview(list))).toEqual(list);
  });
  it("keeps paths inside the app", () => {
    const list = decodeReview(encodeReview({ title: "x", steps: [{ step: "s", path: "https://evil.example" }, { step: "t", path: "//evil.example" }] }));
    expect(list?.steps.map((s) => s.path)).toEqual([undefined, undefined]);
  });
  it("ignores junk", () => {
    expect(decodeReview("not-a-list")).toBeNull();
    expect(decodeReview(null)).toBeNull();
  });
});

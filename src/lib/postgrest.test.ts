import { describe, expect, it } from "vitest";

import { embedded, embeddedOne } from "./postgrest";

describe("reading an embedded relationship", () => {
  it("takes a to-many embed as it comes", () => {
    expect(embedded([{ id: "a" }, { id: "b" }])).toHaveLength(2);
  });

  it("takes a to-one embed, which PostgREST sends as a bare object", () => {
    // job_proposals has a UNIQUE on job_id, so this is what actually arrives.
    // Iterating it directly is what threw ".some is not a function".
    expect(embedded({ id: "a" })).toEqual([{ id: "a" }]);
  });

  it("takes an absent embed as nothing, not as a crash", () => {
    expect(embedded(null)).toEqual([]);
    expect(embedded(undefined)).toEqual([]);
  });

  it("gives the one row of a to-one embed", () => {
    expect(embeddedOne({ id: "a" })).toEqual({ id: "a" });
    expect(embeddedOne([{ id: "a" }, { id: "b" }])).toEqual({ id: "a" });
    expect(embeddedOne(null)).toBeNull();
  });
});

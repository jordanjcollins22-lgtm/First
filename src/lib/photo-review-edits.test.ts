import { describe, expect, it } from "vitest";

import { canApprove, openMarks, reviewStatus, type PhotoMark } from "./photo-review";
import { applyMarkEdit, provisionalMark } from "./photo-review-edits";

function mark(over: Partial<PhotoMark> & { id: string }): PhotoMark {
  return {
    photoId: "photo-1",
    x: 0.5,
    y: 0.5,
    note: "Re-cut the bed edge.",
    authorName: "Dana",
    createdAt: "2026-05-01T09:00:00.000Z",
    resolvedAt: null,
    resolvedByName: null,
    ...over,
  };
}

describe("applyMarkEdit", () => {
  it("takes a resolved mark off the punch list", () => {
    const marks = [mark({ id: "a" }), mark({ id: "b" })];

    const after = applyMarkEdit(marks, { kind: "resolved", id: "a", at: "2026-05-01T10:00:00.000Z" });

    expect(openMarks(after).map((m) => m.id)).toEqual(["b"]);
  });

  it("keeps a resolved mark in the list so an old approval still counts as stale", () => {
    const marks = [mark({ id: "a", createdAt: "2026-05-02T09:00:00.000Z" })];

    const after = applyMarkEdit(marks, { kind: "resolved", id: "a", at: "2026-05-02T10:00:00.000Z" });

    expect(after).toHaveLength(1);
    expect(
      reviewStatus({ crewSignedOff: true, marks: after, approvedAt: "2026-05-01T09:00:00.000Z" })
    ).toBe("awaiting_review");
  });

  it("lets the job be signed off once the last mark is cleared", () => {
    const marks = [mark({ id: "a" })];

    expect(canApprove(marks)).toBe(false);
    expect(
      canApprove(applyMarkEdit(marks, { kind: "resolved", id: "a", at: "2026-05-01T10:00:00.000Z" }))
    ).toBe(true);
  });

  it("drops a mark that was taken back", () => {
    const marks = [mark({ id: "a" }), mark({ id: "b" })];

    expect(applyMarkEdit(marks, { kind: "removed", id: "b" }).map((m) => m.id)).toEqual(["a"]);
  });

  it("shows an added mark before the server has it", () => {
    const added = mark({ id: "local", note: "Gate left open." });

    expect(applyMarkEdit([], { kind: "added", mark: added }).map((m) => m.note)).toEqual([
      "Gate left open.",
    ]);
  });

  it("leaves a mark alone when the edit names an id that is not there", () => {
    const marks = [mark({ id: "a" })];

    expect(applyMarkEdit(marks, { kind: "removed", id: "gone" })).toEqual(marks);
    expect(applyMarkEdit(marks, { kind: "resolved", id: "gone", at: "2026-05-01T10:00:00.000Z" })).toEqual(
      marks
    );
  });

  it("sorts a new mark to the end of the punch list, so the numbers already on screen do not move", () => {
    const existing = [
      mark({ id: "a", createdAt: "2026-05-01T09:00:00.000Z" }),
      mark({ id: "b", createdAt: "2026-05-01T09:30:00.000Z" }),
    ];
    const fresh = mark({ id: "local", createdAt: "2026-05-01T11:00:00.000Z" });

    const after = applyMarkEdit(existing, { kind: "added", mark: fresh });

    expect(openMarks(after).map((m) => m.id)).toEqual(["a", "b", "local"]);
  });
});

describe("provisionalMark", () => {
  it("carries the note the crew will read, trimmed the way the server stores it", () => {
    const local = provisionalMark({
      id: "local-1",
      photoId: "photo-9",
      x: 0.25,
      y: 0.75,
      note: "  Bed edge collapsed at the corner.  ",
      at: "2026-05-01T09:00:00.000Z",
    });

    expect(local.note).toBe("Bed edge collapsed at the corner.");
    expect(local.photoId).toBe("photo-9");
    expect(local.resolvedAt).toBeNull();
  });

  it("puts a pin dropped past the edge of the photo where the server will put it", () => {
    const local = provisionalMark({
      id: "local-1",
      photoId: "photo-9",
      x: 1.04,
      y: -0.02,
      note: "Corner.",
      at: "2026-05-01T09:00:00.000Z",
    });

    expect(local.x).toBe(1);
    expect(local.y).toBe(0);
  });
});

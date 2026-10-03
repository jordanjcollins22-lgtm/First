import { describe, expect, it } from "vitest";

import {
  MARK_HIT_RADIUS,
  addMark,
  markAt,
  markList,
  markNumber,
  moveMark,
  removeMark,
  summariseMarks,
  updateMark,
  withoutEmpty,
  type CanvasMark,
} from "@/lib/canvas-marks";

function mark(id: string, x: number, y: number, note = "note"): CanvasMark {
  return { id, x, y, note, authorName: "Mike", createdAt: "2026-08-01T10:00:00Z" };
}

describe("placing a note", () => {
  it("puts it where it was tapped", () => {
    const marks = addMark([], { x: 120, y: 340 }, "  Broken sprinkler  ", "Mike", "m1");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({ x: 120, y: 340, note: "Broken sprinkler", authorName: "Mike" });
  });

  it("keeps who put it there", () => {
    // A question about a note needs somebody to ask.
    expect(addMark([], { x: 0, y: 0 }, "n", "Dave", "m1")[0].authorName).toBe("Dave");
  });

  it("adds to the end, so numbering follows the order they were placed", () => {
    const marks = addMark(addMark([], { x: 1, y: 1 }, "first", null, "a"), { x: 2, y: 2 }, "second", null, "b");
    expect(marks.map((m) => m.id)).toEqual(["a", "b"]);
    expect(markNumber(marks, "b")).toBe(2);
  });
});

describe("tapping a pin", () => {
  const marks = [mark("a", 100, 100), mark("b", 300, 300)];

  it("finds the pin under the tap", () => {
    expect(markAt(marks, { x: 104, y: 96 })?.id).toBe("a");
  });

  it("finds nothing when the tap is well clear", () => {
    expect(markAt(marks, { x: 500, y: 500 })).toBeNull();
  });

  it("counts a tap right on the edge of the radius", () => {
    expect(markAt(marks, { x: 100 + MARK_HIT_RADIUS, y: 100 })?.id).toBe("a");
    expect(markAt(marks, { x: 100 + MARK_HIT_RADIUS + 1, y: 100 })).toBeNull();
  });

  it("returns the newest when two pins overlap", () => {
    // The one just dropped is the one you were looking at.
    const stacked = [mark("old", 100, 100), mark("new", 102, 102)];
    expect(markAt(stacked, { x: 101, y: 101 })?.id).toBe("new");
  });
});

describe("changing a note", () => {
  const marks = [mark("a", 10, 10, "old"), mark("b", 20, 20)];

  it("rewrites just the one", () => {
    const next = updateMark(marks, "a", "  new text ");
    expect(next[0].note).toBe("new text");
    expect(next[1].note).toBe("note");
  });

  it("moves just the one", () => {
    const next = moveMark(marks, "b", { x: 99, y: 99 });
    expect(next[1]).toMatchObject({ x: 99, y: 99 });
    expect(next[0]).toMatchObject({ x: 10, y: 10 });
  });

  it("removes just the one", () => {
    expect(removeMark(marks, "a").map((m) => m.id)).toEqual(["b"]);
  });

  it("leaves the list alone when the id is not there", () => {
    expect(updateMark(marks, "nope", "x")).toEqual(marks);
    expect(removeMark(marks, "nope")).toHaveLength(2);
  });
});

describe("empty pins", () => {
  it("drops a pin with nothing written on it", () => {
    // An empty pin is a question the crew cannot answer.
    const marks = [mark("a", 1, 1, "real"), mark("b", 2, 2, "   ")];
    expect(withoutEmpty(marks).map((m) => m.id)).toEqual(["a"]);
  });

  it("numbers the list without counting the empty ones", () => {
    const marks = [mark("a", 1, 1, "   "), mark("b", 2, 2, "gate stays shut")];
    expect(markList(marks)).toEqual([{ number: 1, note: "gate stays shut" }]);
  });
});

describe("the one-line version", () => {
  it("joins the first few", () => {
    const marks = [mark("a", 1, 1, "one"), mark("b", 2, 2, "two")];
    expect(summariseMarks(marks)).toBe("one; two");
  });

  it("says how many it left out", () => {
    const marks = ["one", "two", "three", "four"].map((n, i) => mark(String(i), i, i, n));
    expect(summariseMarks(marks, 2)).toBe("one; two (+2 more)");
  });

  it("says nothing when there is nothing", () => {
    expect(summariseMarks([])).toBeNull();
    expect(summariseMarks([mark("a", 1, 1, "  ")])).toBeNull();
  });
});

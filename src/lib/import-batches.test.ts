import { describe, expect, it } from "vitest";

import {
  isRemovable,
  removeLabel,
  summariseBatches,
  UNNAMED_BATCH,
  type BatchRow,
} from "./import-batches";

function row(over: Partial<BatchRow> = {}): BatchRow {
  return {
    id: Math.random().toString(36).slice(2),
    batch: "Bel Air 21014",
    status: "new",
    doNotContact: false,
    touched: false,
    ...over,
  };
}

describe("isRemovable", () => {
  it("removes a row nobody has touched", () => {
    expect(isRemovable(row())).toBe(true);
    expect(isRemovable(row({ status: "queued" }))).toBe(true);
  });

  it("keeps anybody who became a customer", () => {
    // That is not import data any more, it is a customer.
    expect(isRemovable(row({ status: "converted" }))).toBe(false);
  });

  it("keeps anybody who has been contacted", () => {
    expect(isRemovable(row({ status: "contacted" }))).toBe(false);
    expect(isRemovable(row({ touched: true }))).toBe(false);
  });

  it("keeps anybody who asked not to be contacted", () => {
    // Deleting this loses the one fact that stops us ringing them again.
    expect(isRemovable(row({ doNotContact: true }))).toBe(false);
  });

  it("keeps a decision somebody already made", () => {
    expect(isRemovable(row({ status: "rejected" }))).toBe(false);
  });

  it("keeps a touched row even when its status looks untouched", () => {
    expect(isRemovable(row({ status: "new", touched: true }))).toBe(false);
  });
});

describe("summariseBatches", () => {
  it("groups by the batch name given at import", () => {
    const summaries = summariseBatches([
      row({ batch: "A" }),
      row({ batch: "A" }),
      row({ batch: "B" }),
    ]);
    expect(summaries.map((s) => [s.name, s.total])).toEqual([
      ["A", 2],
      ["B", 1],
    ]);
  });

  it("puts the biggest first", () => {
    // The one somebody wants to undo is nearly always the one they just
    // loaded three thousand rows from.
    const summaries = summariseBatches([row({ batch: "small" }), ...Array.from({ length: 3 }, () => row({ batch: "big" }))]);
    expect(summaries[0].name).toBe("big");
  });

  it("gives rows with no batch somewhere to appear", () => {
    expect(summariseBatches([row({ batch: null }), row({ batch: "  " })])[0].name).toBe(
      UNNAMED_BATCH
    );
  });

  it("separates what can go from what is staying", () => {
    const summary = summariseBatches([
      row({ batch: "A" }),
      row({ batch: "A" }),
      row({ batch: "A", status: "converted" }),
    ])[0];
    expect(summary.removable).toHaveLength(2);
    expect(summary.keeping).toBe(1);
  });

  it("says why rows are being kept", () => {
    const summary = summariseBatches([
      row({ status: "converted" }),
      row({ status: "contacted" }),
    ])[0];
    expect(summary.keepingReason).toContain("became customers");
    expect(summary.keepingReason).toContain("have been contacted");
  });

  it("says nothing about keeping when nothing is kept", () => {
    expect(summariseBatches([row(), row()])[0].keepingReason).toBeNull();
  });
});

describe("removeLabel", () => {
  it("names the count so nobody presses it blind", () => {
    const all = summariseBatches([row(), row(), row()])[0];
    expect(removeLabel(all)).toBe("Remove all 3");
  });

  it("says how many of how many when some are staying", () => {
    const some = summariseBatches([row(), row(), row({ status: "converted" })])[0];
    expect(removeLabel(some)).toBe("Remove 2 of 3");
  });

  it("says plainly when nothing can go", () => {
    const none = summariseBatches([row({ status: "converted" })])[0];
    expect(removeLabel(none)).toBe("Nothing here can be removed");
  });

  it("uses no dashes", () => {
    expect(removeLabel(summariseBatches([row(), row()])[0])).not.toMatch(/[—–]/);
  });
});

import { describe, expect, it } from "vitest";

import { countByType, exceptionNeedsOwner, queueLine, sortQueue, type QueueItem } from "./queue";

const item = (over: Partial<QueueItem>): QueueItem => ({
  type: "email",
  id: "x",
  title: "t",
  detail: null,
  kind: null,
  since: "2026-10-10T00:00:00Z",
  dueAt: null,
  href: null,
  canApprove: true,
  approveLabel: "Send",
  canDecline: true,
  ...over,
});

describe("sortQueue", () => {
  it("puts what goes stale soonest first, then the oldest", () => {
    const sorted = sortQueue([
      item({ id: "old-no-due", since: "2026-10-01T00:00:00Z" }),
      item({ id: "due-later", dueAt: "2026-10-14T00:00:00Z" }),
      item({ id: "due-soon", dueAt: "2026-10-13T13:00:00Z" }),
      item({ id: "new-no-due", type: "price", since: "2026-10-12T00:00:00Z" }),
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["due-soon", "due-later", "old-no-due", "new-no-due"]);
  });
});

describe("countByType and queueLine", () => {
  it("counts every type, zero included", () => {
    const counts = countByType([item({ type: "email" }), item({ type: "play" }), item({ type: "play" })]);
    expect(counts).toEqual({ email: 1, price: 0, play: 2, social: 0, pm_draft: 0, exception: 0 });
  });
  it("reads naturally", () => {
    expect(queueLine(0)).toBe("Nothing is waiting for you");
    expect(queueLine(1)).toBe("1 thing is waiting for you");
    expect(queueLine(4)).toBe("4 things are waiting for you");
  });
});

describe("exceptionNeedsOwner", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  it("brings up work stopped at once, and anything unpicked after a day", () => {
    expect(exceptionNeedsOwner({ state: "reported", blocksWork: true, reportedAt: "2026-10-13T11:00:00Z" }, now)).toBe(true);
    expect(exceptionNeedsOwner({ state: "reported", blocksWork: false, reportedAt: "2026-10-13T11:00:00Z" }, now)).toBe(false);
    expect(exceptionNeedsOwner({ state: "reported", blocksWork: false, reportedAt: "2026-10-12T11:00:00Z" }, now)).toBe(true);
  });
  it("leaves picked-up and closed ones with whoever has them", () => {
    expect(exceptionNeedsOwner({ state: "acknowledged", blocksWork: false, reportedAt: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(exceptionNeedsOwner({ state: "resolved", blocksWork: true, reportedAt: "2026-10-01T00:00:00Z" }, now)).toBe(false);
  });
});

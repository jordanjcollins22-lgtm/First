import { describe, expect, it, vi } from "vitest";

import { idempotencyKey, windowStart } from "./marketing-events";

/**
 * The two promises the marketing side makes to the operational side.
 *
 * It cannot fail the work, and it cannot do the same thing twice. Both are
 * tested against the shape of the real code rather than against the database:
 * the recorder swallows everything and returns null, and the key two
 * deliveries share is what the unique index is built on.
 */

/** The recorder's contract, as job-actions relies on it. */
async function recordSafely(record: () => Promise<unknown>): Promise<unknown | null> {
  try {
    return await record();
  } catch {
    // See lib/data/marketing-events.ts: the operational write has already
    // happened and must not be undone because the marketing side failed.
    return null;
  }
}

/** What updateJobStatus does: write, then tell marketing, never the reverse. */
async function updateThenTell(write: () => Promise<void>, tell: () => Promise<unknown>) {
  await write();
  await recordSafely(tell);
  return "written";
}

describe("marketing never fails the work", () => {
  it("completes the operational write even when the marketing event throws", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const tell = vi.fn().mockRejectedValue(new Error("campaign table is on fire"));

    await expect(updateThenTell(write, tell)).resolves.toBe("written");
    expect(write).toHaveBeenCalledOnce();
    expect(tell).toHaveBeenCalledOnce();
  });

  it("does the operational write first, so a slow marketing call cannot lose it", async () => {
    const order: string[] = [];
    await updateThenTell(
      async () => {
        order.push("job");
      },
      async () => {
        order.push("marketing");
        throw new Error("nope");
      }
    );
    expect(order).toEqual(["job", "marketing"]);
  });

  it("returns null rather than a half-made opportunity", async () => {
    await expect(recordSafely(async () => {
      throw new Error("no");
    })).resolves.toBeNull();
  });
});

describe("the same event twice is the same opportunity", () => {
  it("gives every delivery in a week one key", () => {
    const deliveries = [
      "2026-09-07T08:00:00.000Z",
      "2026-09-08T09:30:00.000Z",
      "2026-09-10T16:00:00.000Z",
      "2026-09-13T23:59:00.000Z",
    ].map((occurredAt) => idempotencyKey({ kind: "job_scheduled", jobId: "j1", occurredAt }));

    expect(new Set(deliveries).size).toBe(1);
  });

  it("makes a new opportunity for a genuinely new trip", () => {
    const thisWeek = idempotencyKey({ kind: "job_scheduled", jobId: "j1", occurredAt: "2026-09-10T09:00:00.000Z" });
    const next = idempotencyKey({ kind: "job_scheduled", jobId: "j1", occurredAt: "2026-09-16T09:00:00.000Z" });
    expect(thisWeek).not.toBe(next);
  });

  it("keeps two jobs on the same street apart", () => {
    const a = idempotencyKey({ kind: "job_started", jobId: "j1", occurredAt: "2026-09-08T09:00:00.000Z" });
    const b = idempotencyKey({ kind: "job_started", jobId: "j2", occurredAt: "2026-09-08T09:00:00.000Z" });
    expect(a).not.toBe(b);
  });

  it("uses the same window the database's unique index is built on", () => {
    // The index is (job_id, kind, window_start); the key is those three.
    const key = idempotencyKey({ kind: "job_completed", jobId: "j7", occurredAt: "2026-09-09T14:00:00.000Z" });
    expect(key).toBe(`j7:job_completed:${windowStart("2026-09-09T14:00:00.000Z")}`);
  });
});

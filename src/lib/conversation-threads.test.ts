import { describe, expect, it } from "vitest";

import {
  MAX_MESSAGE_WINDOW,
  messageWindows,
  newestPerThread,
  threadKey,
} from "./conversation-threads";

function message(job_id: string, channel: string, created_at: string, body = "") {
  return { job_id, channel, created_at, body };
}

describe("threadKey", () => {
  it("keeps the same job's two channels apart", () => {
    // An internal note and a client message on the same job are two inbox
    // rows, two read marks, and two different things to be behind on.
    expect(threadKey("job-1", "internal")).not.toBe(threadKey("job-1", "external"));
  });
});

describe("newestPerThread", () => {
  it("returns one row per job and channel", () => {
    const threads = newestPerThread([
      message("job-1", "external", "2026-08-01T10:00:00Z"),
      message("job-1", "external", "2026-08-02T10:00:00Z"),
      message("job-1", "internal", "2026-08-03T10:00:00Z"),
      message("job-2", "external", "2026-08-04T10:00:00Z"),
    ]);
    expect(threads.map((t) => t.key)).toEqual([
      "job-2:external",
      "job-1:internal",
      "job-1:external",
    ]);
  });

  it("keeps the newest message whatever order they arrive in", () => {
    // The query orders them today. A grouping that returns the wrong last
    // message the day somebody edits that clause is a bug nobody looks for.
    const threads = newestPerThread([
      message("job-1", "external", "2026-08-01T10:00:00Z", "oldest"),
      message("job-1", "external", "2026-08-09T10:00:00Z", "newest"),
      message("job-1", "external", "2026-08-05T10:00:00Z", "middle"),
    ]);
    expect(threads[0].lastMessage.body).toBe("newest");
  });

  it("sorts most recently active first", () => {
    const threads = newestPerThread([
      message("quiet", "external", "2026-01-01T00:00:00Z"),
      message("loud", "external", "2026-08-30T00:00:00Z"),
      message("middling", "external", "2026-05-05T00:00:00Z"),
    ]);
    expect(threads.map((t) => t.jobId)).toEqual(["loud", "middling", "quiet"]);
  });

  it("orders two conversations answered in the same second the same way twice", () => {
    // Without a tiebreak the rows swap places between two loads of the same
    // page, which reads as the inbox changing under somebody's thumb.
    const same = "2026-08-30T12:00:00Z";
    const first = newestPerThread([message("b", "external", same), message("a", "external", same)]);
    const second = newestPerThread([message("a", "external", same), message("b", "external", same)]);
    expect(first.map((t) => t.key)).toEqual(second.map((t) => t.key));
  });

  it("counts only the messages it was given, which is the window", () => {
    // The count is a floor by design: the exact total would cost a scan of
    // every message ever written to fill in small grey text.
    const threads = newestPerThread([
      message("job-1", "external", "2026-08-01T10:00:00Z"),
      message("job-1", "external", "2026-08-02T10:00:00Z"),
      message("job-1", "external", "2026-08-03T10:00:00Z"),
    ]);
    expect(threads[0].messageCount).toBe(3);
  });

  it("has nothing to show for no messages", () => {
    expect(newestPerThread([])).toEqual([]);
  });
});

describe("messageWindows", () => {
  it("asks for enough messages to fill the page in one read", () => {
    // Fifty conversations, one more to know whether there is a next page.
    expect(messageWindows(50)[0]).toBe(51 * 8);
  });

  it("offers a second, wider read for when one busy job fills the window", () => {
    const windows = messageWindows(50);
    expect(windows).toHaveLength(2);
    expect(windows[1]).toBe(MAX_MESSAGE_WINDOW);
    expect(windows[1]).toBeGreaterThan(windows[0]);
  });

  it("never asks for more than the ceiling", () => {
    for (const size of messageWindows(400)) expect(size).toBeLessThanOrEqual(MAX_MESSAGE_WINDOW);
  });

  it("stops at one read once the first one already hits the ceiling", () => {
    // A second identical query answers nothing the first did not.
    expect(messageWindows(50, 100)).toEqual([100]);
  });

  it("still reads enough to answer a page bigger than the ceiling", () => {
    // Not a licence to read the table: the caller's own cap is what keeps
    // this small, and this only stops the window being narrower than the
    // page it is meant to fill.
    expect(messageWindows(500, 100)).toEqual([501]);
  });
});

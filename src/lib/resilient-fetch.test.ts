import { describe, expect, it } from "vitest";

import {
  backoffDelayMs,
  fetchJson,
  isRetryableStatus,
  retrySchedule,
  worstCaseMs,
} from "./resilient-fetch";

describe("isRetryableStatus", () => {
  it("tries a rate limit again", () => {
    expect(isRetryableStatus(429)).toBe(true);
  });

  it("tries a struggling service again", () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
  });

  it("tries a timeout the service reported itself again", () => {
    expect(isRetryableStatus(408)).toBe(true);
  });

  it("never repeats a request the service already rejected", () => {
    // A 400 will be a 400 again, and sending it twice more is how a client
    // earns a rate limit it did not need.
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(422)).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("doubles the wait with every attempt", () => {
    const opts = { baseMs: 100, maxMs: 10_000 };
    expect(backoffDelayMs(1, opts)).toBe(100);
    expect(backoffDelayMs(2, opts)).toBe(200);
    expect(backoffDelayMs(3, opts)).toBe(400);
  });

  it("never waits longer than the ceiling", () => {
    const opts = { baseMs: 100, maxMs: 500 };
    expect(backoffDelayMs(10, opts)).toBe(500);
    expect(backoffDelayMs(50, opts)).toBe(500);
  });

  it("keeps half the wait guaranteed however the jitter falls", () => {
    // Full jitter can land on nearly nothing, which is not backing off at all.
    const opts = { baseMs: 400, maxMs: 10_000 };
    expect(backoffDelayMs(1, { ...opts, jitter: 0 })).toBe(200);
    expect(backoffDelayMs(1, { ...opts, jitter: 0.5 })).toBe(300);
    expect(backoffDelayMs(1, { ...opts, jitter: 1 })).toBe(400);
  });

  it("treats a jitter outside 0..1 as the nearest end of the window", () => {
    const opts = { baseMs: 400, maxMs: 10_000 };
    expect(backoffDelayMs(1, { ...opts, jitter: -3 })).toBe(200);
    expect(backoffDelayMs(1, { ...opts, jitter: 7 })).toBe(400);
  });

  it("waits for nothing before the first attempt", () => {
    expect(backoffDelayMs(0)).toBe(0);
  });
});

describe("retrySchedule", () => {
  it("waits once between two attempts, never after the last one", () => {
    expect(retrySchedule(2, { baseMs: 100 })).toEqual([100]);
    expect(retrySchedule(3, { baseMs: 100 })).toEqual([100, 200]);
  });

  it("waits for nothing at all when there is only one attempt", () => {
    expect(retrySchedule(1)).toEqual([]);
  });

  it("stays bounded however many attempts are asked for", () => {
    const waits = retrySchedule(12, { baseMs: 200, maxMs: 2_000 });
    expect(Math.max(...waits)).toBe(2_000);
  });
});

describe("worstCaseMs", () => {
  it("counts every deadline and every wait between them", () => {
    // The number a batch is sized against: two 4s attempts with a 200ms wait
    // in between is the longest one lookup can hold a request open.
    expect(worstCaseMs(2, 4_000, { baseMs: 200, maxMs: 2_000 })).toBe(8_200);
  });

  it("is just the deadline when nothing is retried", () => {
    expect(worstCaseMs(1, 3_000)).toBe(3_000);
  });
});

/** A fetch that answers from a script, so no test touches the network. */
function scriptedFetch(steps: (() => Response | Error)[]): { fn: typeof fetch; calls: () => number } {
  let call = 0;
  const fn = (async () => {
    const step = steps[Math.min(call, steps.length - 1)]();
    call++;
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof fetch;
  return { fn, calls: () => call };
}

function withFetch<T>(fn: typeof fetch, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const noSleep = async () => {};

describe("fetchJson", () => {
  it("hands back the parsed body on a success", async () => {
    const { fn } = scriptedFetch([() => Response.json({ hello: "world" })]);
    const outcome = await withFetch(fn, () =>
      fetchJson<{ hello: string }>("https://example.test/x", { sleep: noSleep })
    );
    expect(outcome).toMatchObject({ ok: true, value: { hello: "world" }, attempts: 1 });
  });

  it("tries again after a 503 and succeeds on the second go", async () => {
    const { fn, calls } = scriptedFetch([
      () => new Response("busy", { status: 503 }),
      () => Response.json({ hello: "world" }),
    ]);
    const outcome = await withFetch(fn, () =>
      fetchJson<{ hello: string }>("https://example.test/x", { attempts: 2, sleep: noSleep })
    );
    expect(outcome.ok).toBe(true);
    expect(calls()).toBe(2);
  });

  it("gives up on a 400 without spending a second call", async () => {
    const { fn, calls } = scriptedFetch([() => new Response("nope", { status: 400 })]);
    const outcome = await withFetch(fn, () =>
      fetchJson("https://example.test/x", { attempts: 3, sleep: noSleep })
    );
    expect(outcome).toMatchObject({ ok: false, kind: "http", status: 400, retryable: false });
    expect(calls()).toBe(1);
  });

  it("stops after the attempts it was given rather than retrying forever", async () => {
    const { fn, calls } = scriptedFetch([() => new Response("busy", { status: 503 })]);
    const outcome = await withFetch(fn, () =>
      fetchJson("https://example.test/x", { attempts: 3, sleep: noSleep })
    );
    expect(outcome).toMatchObject({ ok: false, kind: "http", status: 503, attempts: 3 });
    expect(calls()).toBe(3);
  });

  it("reports a service that never answers as a timeout rather than hanging", async () => {
    const hang = (async (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      })) as unknown as typeof fetch;

    const outcome = await withFetch(hang, () =>
      fetchJson("https://example.test/x", { attempts: 1, timeoutMs: 20 })
    );
    expect(outcome).toMatchObject({ ok: false, kind: "timeout", retryable: true });
  });

  it("calls a network failure retryable, since the service was never reached", async () => {
    const { fn } = scriptedFetch([() => new Error("ECONNRESET")]);
    const outcome = await withFetch(fn, () =>
      fetchJson("https://example.test/x", { attempts: 1, sleep: noSleep })
    );
    expect(outcome).toMatchObject({ ok: false, kind: "network", retryable: true });
  });

  it("does not repeat a request for a body that wasn't JSON", async () => {
    const { fn, calls } = scriptedFetch([() => new Response("<html>maintenance</html>", { status: 200 })]);
    const outcome = await withFetch(fn, () =>
      fetchJson("https://example.test/x", { attempts: 3, sleep: noSleep })
    );
    expect(outcome).toMatchObject({ ok: false, kind: "parse", retryable: false });
    expect(calls()).toBe(1);
  });

  it("reports the caller's own cancellation as cancelled, not as a fault", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fn, calls } = scriptedFetch([() => Response.json({})]);
    const outcome = await withFetch(fn, () =>
      fetchJson("https://example.test/x", { signal: controller.signal, sleep: noSleep })
    );
    expect(outcome).toMatchObject({ ok: false, kind: "aborted", retryable: false });
    expect(calls()).toBe(0);
  });
});

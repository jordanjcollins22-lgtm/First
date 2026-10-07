/**
 * One way out to the internet, with a clock on it.
 *
 * Every third party this app talks to — Mapbox, RentCast, Open-Meteo — sits in
 * front of a person waiting for a button to finish. A bare `await fetch(...)`
 * has no upper bound: when a provider stops answering rather than refusing,
 * the socket stays open, the server action stays open, and the user watches a
 * spinner until the platform kills the request. That is the failure this
 * exists to make impossible. Nothing here reaches the network without a
 * deadline it cannot outlive.
 *
 * Failure comes back as a value rather than a throw. A caller that has a
 * sensible thing to do when a service is down — show the address without a lot
 * size, skip the weather strip, leave a contact in the queue for the next run —
 * should be able to write that down as an ordinary branch, not remember to
 * wrap the call. The kinds are separated because they deserve different
 * answers: a 400 means the request was wrong and will be wrong again, a 429 or
 * a 503 means come back shortly, and a timeout means we never found out.
 */

/** Why a call did not produce a body. */
export type FetchFailureKind =
  /** The deadline passed before the service answered. */
  | "timeout"
  /** DNS, TLS, connection reset — never reached the service. */
  | "network"
  /** The service answered, with a status that is not a success. */
  | "http"
  /** The caller cancelled: a new keystroke, a closed tab. Not a fault. */
  | "aborted"
  /** A success status carrying something that is not the JSON we expect. */
  | "parse";

export interface FetchFailure {
  ok: false;
  kind: FetchFailureKind;
  /** The status when the service answered at all, otherwise null. */
  status: number | null;
  /** Plain enough to put in front of somebody, if a caller chooses to. */
  message: string;
  /**
   * Whether the same call could plausibly succeed later.
   *
   * This is the flag that decides whether work gets marked as attempted. A
   * malformed address is never going to geocode; a 503 will, in a minute, and
   * recording it as a permanent failure loses the row for good.
   */
  retryable: boolean;
  /** How many times we actually went out to the network. */
  attempts: number;
}

export type FetchOutcome<T> = { ok: true; value: T; attempts: number } | FetchFailure;

export interface BackoffOptions {
  /** The first wait. Doubles from here. */
  baseMs?: number;
  /** The ceiling on any single wait, however many attempts have gone by. */
  maxMs?: number;
  /**
   * Where in the jitter window this wait falls, 0 to 1.
   *
   * Passed in rather than rolled inside so the arithmetic stays a pure
   * function: the retry maths is worth testing, and a test should not have to
   * stub `Math.random` or run a clock to do it. Defaults to the top of the
   * window, which is the worst case and therefore the honest one to reason
   * about when working out a batch's budget.
   */
  jitter?: number;
}

const DEFAULT_BASE_MS = 200;
const DEFAULT_MAX_MS = 2_000;

/**
 * Statuses worth trying again.
 *
 * Retrying a 400 is how a rate limit turns into a ban: the request was wrong,
 * and sending it three more times is three more wrong requests. Only the
 * statuses that mean "not now" get a second go — the overloaded ones, the
 * timeouts the far end reports itself, and the explicit "slow down".
 */
export function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500 && status <= 599;
}

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * Exponential so a service that is genuinely struggling is not hammered flat
 * by its own clients, capped so a long backoff can never be the reason a
 * request outlives its budget, and jittered so a hundred instances coming out
 * of the same outage do not arrive back in lockstep.
 */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseMs ?? DEFAULT_BASE_MS;
  const max = options.maxMs ?? DEFAULT_MAX_MS;
  const jitter = options.jitter ?? 1;

  if (attempt < 1) return 0;

  const exponential = base * 2 ** (attempt - 1);
  const capped = Math.min(exponential, max);
  // Equal jitter: half the wait is guaranteed, half is spread. Full jitter can
  // land on nearly zero, which defeats the point of backing off at all.
  const half = capped / 2;
  return Math.round(half + half * Math.min(1, Math.max(0, jitter)));
}

/**
 * Every wait a call of this shape can incur, in order.
 *
 * Exposed so a caller sizing a batch can ask what it is committing to rather
 * than guessing, and so a test can prove the retrying is bounded.
 */
export function retrySchedule(attempts: number, options: BackoffOptions = {}): number[] {
  const waits: number[] = [];
  for (let attempt = 1; attempt < attempts; attempt++) {
    waits.push(backoffDelayMs(attempt, options));
  }
  return waits;
}

/**
 * The longest a single call can take before it gives up.
 *
 * The number that matters when deciding how much work fits in one request. A
 * batch that multiplies this by its size and gets more than the platform's
 * limit is a batch that will be killed halfway.
 */
export function worstCaseMs(
  attempts: number,
  timeoutMs: number,
  options: BackoffOptions = {}
): number {
  const waits = retrySchedule(attempts, options).reduce((sum, ms) => sum + ms, 0);
  return attempts * timeoutMs + waits;
}

export interface ResilientFetchOptions extends BackoffOptions {
  /** Deadline for one attempt, headers and body together. */
  timeoutMs?: number;
  /** Total trips to the network, first one included. Bounded on purpose. */
  attempts?: number;
  /** Passed straight through: headers, method, Next's cache hints. */
  init?: RequestInit;
  /** The caller's own cancellation — a superseded keystroke, a closed page. */
  signal?: AbortSignal;
  /** Swapped out in tests so retry behaviour needs no real clock. */
  sleep?: (ms: number) => Promise<void>;
  /** Swapped out in tests so the jitter is not a coin toss. */
  random?: () => number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_ATTEMPTS = 2;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetches JSON, or says why it could not.
 *
 * The body is read inside the same deadline as the headers. Timing out on the
 * connection but then waiting forever on a trickling body would be a bound in
 * name only, and a slow body is exactly what a struggling service produces.
 */
export async function fetchJson<T>(
  url: string | URL,
  options: ResilientFetchOptions = {}
): Promise<FetchOutcome<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const target = url.toString();

  let failure: FetchFailure = {
    ok: false,
    kind: "network",
    status: null,
    message: "Request was never attempted.",
    retryable: true,
    attempts: 0,
  };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (options.signal?.aborted) {
      return {
        ok: false,
        kind: "aborted",
        status: null,
        message: "Cancelled.",
        retryable: false,
        attempts: attempt - 1,
      };
    }

    const outcome = await attemptJson<T>(target, timeoutMs, options.init, options.signal, attempt);
    if (outcome.ok) return outcome;

    failure = outcome;
    const lastAttempt = attempt === attempts;
    if (!failure.retryable || lastAttempt) return failure;

    await sleep(backoffDelayMs(attempt, { ...options, jitter: random() }));
  }

  return failure;
}

/** One trip to the network, with its own controller so its deadline dies with it. */
async function attemptJson<T>(
  target: string,
  timeoutMs: number,
  init: RequestInit | undefined,
  callerSignal: AbortSignal | undefined,
  attempt: number
): Promise<FetchOutcome<T>> {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const forwardAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", forwardAbort);

  try {
    const res = await fetch(target, { ...init, signal: controller.signal });

    if (!res.ok) {
      // The body of an error is not worth reading, but it must be released or
      // the connection is held open by a response nobody is listening to.
      // Released rather than waited on: a cancel that does not settle would be
      // one more unbounded wait, which is the whole thing this file exists to
      // stop.
      void res.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        kind: "http",
        status: res.status,
        message: `Service returned ${res.status}.`,
        retryable: isRetryableStatus(res.status),
        attempts: attempt,
      };
    }

    try {
      return { ok: true, value: (await res.json()) as T, attempts: attempt };
    } catch {
      // A 200 carrying an error page or a truncated body. Trying again would
      // ask the same question and get the same answer.
      return {
        ok: false,
        kind: "parse",
        status: res.status,
        message: "Service answered with something that wasn't JSON.",
        retryable: false,
        attempts: attempt,
      };
    }
  } catch (err) {
    if (callerSignal?.aborted) {
      return { ok: false, kind: "aborted", status: null, message: "Cancelled.", retryable: false, attempts: attempt };
    }
    if (timedOut) {
      return {
        ok: false,
        kind: "timeout",
        status: null,
        message: `Service didn't answer within ${Math.round(timeoutMs / 1000)}s.`,
        retryable: true,
        attempts: attempt,
      };
    }
    return {
      ok: false,
      kind: "network",
      status: null,
      message: err instanceof Error ? err.message : "Couldn't reach the service.",
      retryable: true,
      attempts: attempt,
    };
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", forwardAbort);
  }
}

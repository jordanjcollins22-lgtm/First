/**
 * Small fetch wrapper shared by every govcon data source: JSON in/out,
 * timeout, and retry with exponential backoff on 429/5xx/network errors.
 * Government APIs are flaky enough that a daily unattended run needs this.
 */
export interface FetchJsonOptions {
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    public bodyText: string
  ) {
    super(`HTTP ${status} from ${redact(url)}: ${bodyText.slice(0, 300)}`);
  }
}

/** Strip api_key query params so keys never land in logs or the runs table. */
export function redact(url: string): string {
  return url.replace(/(api_key=)[^&]+/gi, "$1***");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson<T>(
  url: string,
  { method = "GET", body, headers = {}, timeoutMs = 30_000, retries = 3 }: FetchJsonOptions = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;

      const text = await res.text();
      const err = new HttpError(res.status, url, text);
      // 4xx other than 429 won't get better on retry.
      if (res.status !== 429 && res.status < 500) throw err;
      lastError = err;
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastError = e;
    }
    if (attempt < retries) await sleep(1000 * 2 ** attempt);
  }
  throw lastError;
}

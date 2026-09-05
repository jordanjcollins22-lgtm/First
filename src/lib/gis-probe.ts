/**
 * The one place this app talks to the county's GIS server.
 *
 * Written to answer a specific question when it does not work: where did the
 * request run, what exactly was asked, and what exactly came back. A bare
 * "fetch failed" cannot be diagnosed; a record saying the request left a
 * Vercel function in iad1, resolved the host, and got a 403 with this body
 * can be.
 *
 * Nothing in here is ever called from the browser. A browser hitting the
 * county would raise CORS, and CORS is not a fact about the county.
 */

/** Where a request ran from, read off the environment rather than guessed. */
export interface RequestOrigin {
  /** vercel | sandbox | local */
  platform: "vercel" | "sandbox" | "local";
  /** production | preview | development, when Vercel says. */
  environment: string | null;
  region: string | null;
  /** server-action | route-handler | background-job | page-render */
  runtime: string;
  node: string;
  /** Whether the process this ran in could authenticate a background step. Never the value. */
  cronSecretPresent: boolean;
}

export function describeOrigin(runtime: RequestOrigin["runtime"]): RequestOrigin {
  const onVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
  // The Claude sandbox routes every request through an egress proxy, which is
  // what refuses the county host with a 403 on CONNECT. Nothing else sets these.
  const inSandbox = !onVercel && Boolean(process.env.HTTPS_PROXY && process.env.HTTPS_PROXY.includes("127.0.0.1"));

  return {
    platform: onVercel ? "vercel" : inSandbox ? "sandbox" : "local",
    environment: process.env.VERCEL_ENV ?? null,
    region: process.env.VERCEL_REGION ?? null,
    runtime,
    node: process.version,
    cronSecretPresent: (process.env.CRON_SECRET ?? "").trim().length > 0,
  };
}

/**
 * What the server process can see of its own configuration. Safe to show.
 *
 * Answers one question without leaking anything: is CRON_SECRET actually in
 * this process's environment? The value is never read out -- only whether it
 * is there and how long it is -- and the names of any variables that look
 * like an attempt at it, so a stray space or a near-miss in the name is
 * visible instead of a mystery. Read straight from process.env at call time,
 * not from a module-level snapshot, so it cannot describe a different moment
 * than the one it is answering for.
 */
export interface ServerEnvDiagnostic {
  checkedAt: string;
  origin: RequestOrigin;
  cronSecretPresent: boolean;
  /** Raw length, spaces included, so a value that is only whitespace shows as present-but-blank. */
  cronSecretLength: number;
  /** Environment variable names containing "cron", any case. Names only. */
  cronLikeNames: string[];
  supabaseAdminPresent: boolean;
  gitBranch: string | null;
  gitSha: string | null;
  deploymentId: string | null;
}

export function serverEnvDiagnostic(runtime: RequestOrigin["runtime"]): ServerEnvDiagnostic {
  const secret = process.env.CRON_SECRET ?? "";
  return {
    checkedAt: new Date().toISOString(),
    origin: describeOrigin(runtime),
    cronSecretPresent: secret.trim().length > 0,
    cronSecretLength: secret.length,
    cronLikeNames: Object.keys(process.env)
      .filter((name) => /cron/i.test(name))
      .sort(),
    supabaseAdminPresent: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    gitBranch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
  };
}

/** What one request did. Written to the job's diagnostics exactly as is. */
export interface ProbeResult {
  at: string;
  url: string;
  ok: boolean;
  /** ok | http | timeout | dns | refused | tls | network | parse */
  kind: string;
  status: number | null;
  statusText: string | null;
  /** The first part of whatever came back, JSON or not. */
  bodySnippet: string | null;
  /** The parsed body, when it was JSON. */
  body: unknown;
  /** Node's own error code: ENOTFOUND, ECONNREFUSED, ETIMEDOUT, CERT_HAS_EXPIRED. */
  errorCode: string | null;
  message: string | null;
  elapsedMs: number;
  origin: RequestOrigin;
  /** Always false here, and said out loud: this request never ran in a browser. */
  corsApplicable: false;
}

const SNIPPET = 600;

/**
 * One GET, one deadline, everything recorded.
 *
 * Unlike the shared resilient fetch this keeps the body of an error response,
 * because the body is the diagnosis: an ArcGIS 403 says why in HTML, and a
 * proxy's 403 says which proxy. No retries, since a diagnostic that retries
 * three times reports the third failure and hides the first.
 */
export async function probeEndpoint(
  url: string,
  runtime: RequestOrigin["runtime"],
  timeoutMs = 15_000
): Promise<ProbeResult> {
  const origin = describeOrigin(runtime);
  const started = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const base = {
    at: new Date().toISOString(),
    url,
    origin,
    corsApplicable: false as const,
    statusText: null as string | null,
    bodySnippet: null as string | null,
    body: null as unknown,
    errorCode: null as string | null,
  };

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "jslandscaping-app/1.0 (+gis import)" },
      cache: "no-store",
    });
    const raw = await res.text();
    const snippet = raw.slice(0, SNIPPET) || null;
    let parsed: unknown = null;
    let parseFailed = false;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parseFailed = true;
    }

    if (!res.ok) {
      return {
        ...base,
        ok: false,
        kind: "http",
        status: res.status,
        statusText: res.statusText || null,
        bodySnippet: snippet,
        body: parsed,
        message: `The server answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.`,
        elapsedMs: Date.now() - started,
      };
    }

    if (parseFailed) {
      return {
        ...base,
        ok: false,
        kind: "parse",
        status: res.status,
        statusText: res.statusText || null,
        bodySnippet: snippet,
        message: "The server answered 200 with something that was not JSON.",
        elapsedMs: Date.now() - started,
      };
    }

    return {
      ...base,
      ok: true,
      kind: "ok",
      status: res.status,
      statusText: res.statusText || null,
      bodySnippet: snippet,
      body: parsed,
      message: null,
      elapsedMs: Date.now() - started,
    };
  } catch (err) {
    const code = errorCodeOf(err);
    const message = err instanceof Error ? err.message : String(err);
    const kind = timedOut
      ? "timeout"
      : code === "ENOTFOUND" || code === "EAI_AGAIN"
        ? "dns"
        : code === "ECONNREFUSED"
          ? "refused"
          : code && /CERT|TLS|SSL|DEPTH_ZERO|UNABLE_TO_VERIFY/i.test(code)
            ? "tls"
            : "network";
    return {
      ...base,
      ok: false,
      kind,
      status: null,
      errorCode: code,
      message: timedOut ? `No answer within ${Math.round(timeoutMs / 1000)}s.` : message,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Digs the system error code out of undici's wrapping, when there is one. */
function errorCodeOf(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

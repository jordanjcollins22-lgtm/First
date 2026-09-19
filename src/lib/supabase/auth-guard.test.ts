import { describe, expect, it } from "vitest";

import {
  decideAccess,
  getUserWithRetry,
  hasAuthCookie,
  isDefinitiveAuthFailure,
} from "@/lib/supabase/auth-guard";

const SESSION = ["sb-ehktemopxfhyaufzfepy-auth-token"];
const CHUNKED = ["sb-ehktemopxfhyaufzfepy-auth-token.0", "sb-ehktemopxfhyaufzfepy-auth-token.1"];

describe("hasAuthCookie", () => {
  it("finds a session cookie", () => {
    expect(hasAuthCookie(SESSION)).toBe(true);
  });

  it("finds one split across chunks", () => {
    expect(hasAuthCookie(CHUNKED)).toBe(true);
  });

  it("is false with only unrelated cookies", () => {
    expect(hasAuthCookie(["theme", "sb-something-else"])).toBe(false);
    expect(hasAuthCookie([])).toBe(false);
  });
});

describe("isDefinitiveAuthFailure", () => {
  it("treats 401 and 403 as the server saying no", () => {
    expect(isDefinitiveAuthFailure({ status: 401 })).toBe(true);
    expect(isDefinitiveAuthFailure({ status: 403 })).toBe(true);
  });

  it("does not treat a retryable fetch failure as a verdict", () => {
    expect(isDefinitiveAuthFailure({ name: "AuthRetryableFetchError" })).toBe(false);
  });

  it("does not treat a server error or timeout as a verdict", () => {
    expect(isDefinitiveAuthFailure({ status: 500 })).toBe(false);
    expect(isDefinitiveAuthFailure({ status: 0, message: "fetch failed" })).toBe(false);
  });

  it("is false with no error", () => {
    expect(isDefinitiveAuthFailure(null)).toBe(false);
  });
});

describe("decideAccess", () => {
  const base = { isPublicPath: false, cookieNames: SESSION, user: null, error: null };

  it("lets a signed-in person through", () => {
    expect(decideAccess({ ...base, user: { id: "u1" } })).toBe("allow");
  });

  it("lets anybody through on a public path", () => {
    // /login, /book and a client's proposal link have no session by design.
    expect(decideAccess({ ...base, isPublicPath: true, cookieNames: [] })).toBe("allow");
  });

  it("sends a genuinely signed-out person to login", () => {
    expect(decideAccess({ ...base, cookieNames: [] })).toBe("redirect_to_login");
  });

  it("sends somebody with a rejected token to login", () => {
    expect(decideAccess({ ...base, error: { status: 401 } })).toBe("redirect_to_login");
  });

  it("lets a signed-in person through when the check itself failed", () => {
    // The bug this fixes: a dead spot or a cold start looked exactly like
    // being signed out, and threw people out of an app they were logged into.
    expect(decideAccess({ ...base, error: { name: "AuthRetryableFetchError" } })).toBe("allow");
    expect(decideAccess({ ...base, error: { status: 500 } })).toBe("allow");
  });

  it("still redirects when there is a cookie but no error and no user", () => {
    // A cookie that resolved cleanly to nobody is an expired session, which is
    // a real answer and should send them to log in again.
    expect(decideAccess({ ...base, error: null })).toBe("redirect_to_login");
  });

  it("holds for a chunked session cookie too", () => {
    expect(decideAccess({ ...base, cookieNames: CHUNKED, error: { status: 503 } })).toBe("allow");
  });
});

describe("getUserWithRetry", () => {
  const user = { id: "u1" };

  it("returns straight away when the first try works", async () => {
    let calls = 0;
    const result = await getUserWithRetry(async () => {
      calls++;
      return { data: { user }, error: null };
    });
    expect(result.data.user).toEqual(user);
    expect(calls).toBe(1);
  });

  it("retries a transport failure and succeeds", async () => {
    // The flake this exists for: one request lost the network.
    let calls = 0;
    const result = await getUserWithRetry(async () => {
      calls++;
      if (calls === 1) return { data: { user: null }, error: { name: "AuthRetryableFetchError" } };
      return { data: { user }, error: null };
    });
    expect(result.data.user).toEqual(user);
    expect(calls).toBe(2);
  });

  it("does not retry a clean signed-out answer", async () => {
    // Retrying would slow down every signed-out page load for nothing.
    let calls = 0;
    await getUserWithRetry(async () => {
      calls++;
      return { data: { user: null }, error: null };
    });
    expect(calls).toBe(1);
  });

  it("does not retry a rejected token", async () => {
    let calls = 0;
    await getUserWithRetry(async () => {
      calls++;
      return { data: { user: null }, error: { status: 401 } };
    });
    expect(calls).toBe(1);
  });

  it("gives up after the second failure rather than looping", async () => {
    let calls = 0;
    const result = await getUserWithRetry(async () => {
      calls++;
      return { data: { user: null }, error: { status: 503 } };
    });
    expect(calls).toBe(2);
    expect(result.data.user).toBeNull();
  });

  it("survives a lookup that throws instead of returning an error", async () => {
    const result = await getUserWithRetry(async () => {
      throw new TypeError("fetch failed");
    });
    expect(result.data.user).toBeNull();
    expect(result.error?.message).toBe("fetch failed");
  });
});

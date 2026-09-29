import { cookies } from "next/headers";

import { DEMO_BLOCKED, DEMO_COOKIE, demoBlocks, demoRefusal } from "@/lib/demo-guard";

/**
 * The demo, on the server: whether the request being answered is from an open
 * demo, and the guards that make it look-only. See demo-guard.ts.
 */

/**
 * Whether this request is from an open demo. False outside a request (a
 * timer, a webhook, a script), which never carries the demo's cookie.
 */
export async function inDemo(): Promise<boolean> {
  try {
    const store = await cookies();
    return store.get(DEMO_COOKIE)?.value === "1";
  } catch {
    return false;
  }
}

/**
 * The fetch every database connection on the server uses: in a demo, a
 * request that would change something is answered with the demo's refusal
 * instead of being sent. Outside a demo it is plain fetch.
 */
export const demoGuardFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
  if (demoBlocks(url, method) && (await inDemo())) return demoRefusal();
  return fetch(input, init);
};

/**
 * For the things the app sends to the outside world -- emails, texts, calls,
 * payments, posts: refuses in a demo, before anything goes.
 */
export async function refuseInDemo(): Promise<void> {
  if (await inDemo()) throw new Error(DEMO_BLOCKED);
}

/**
 * A fetch for a service outside the app (Stripe): looking goes through, and
 * in a demo anything that would create, charge or send is refused, in the
 * shape Stripe reports its own errors, so it reads like any other failure.
 */
export const demoSendFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD" && (await inDemo())) {
    return new Response(JSON.stringify({ error: { message: DEMO_BLOCKED, type: "invalid_request_error" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return fetch(input, init);
};

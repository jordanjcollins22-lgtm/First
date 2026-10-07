import { createBrowserClient } from "@supabase/ssr";

import { env } from "@/lib/env";
import { cookieSaysDemo, demoBlocks, demoRefusal } from "@/lib/demo-guard";

import type { Database } from "./database.types";

/** In a demo, the browser sends nothing that would change something either (lib/demo-guard.ts). */
const browserFetch: typeof fetch = (input, init) => {
  if (typeof document !== "undefined" && cookieSaysDemo(document.cookie)) {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
    if (demoBlocks(url, method)) return Promise.resolve(demoRefusal());
  }
  return fetch(input, init);
};

export function createClient() {
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey, { global: { fetch: browserFetch } });
}

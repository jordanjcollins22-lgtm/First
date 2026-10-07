import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Service-role client for unattended server jobs (the govcon cron), which
 * run with no user session and so can't use the cookie-based client.
 * Never import this from client components.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.supabaseUrl || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for the govcon pipeline."
    );
  }
  return createClient<Database>(env.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

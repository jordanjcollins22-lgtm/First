import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { env, serverEnv } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Service-role client for code that runs without a user session (cron and
 * webhooks). It bypasses RLS, so only use it in route handlers that do their
 * own auth.
 */
export function createAdminClient() {
  if (!env.supabaseUrl || !serverEnv.supabaseServiceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for server-side jobs."
    );
  }
  return createSupabaseClient<Database>(env.supabaseUrl, serverEnv.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

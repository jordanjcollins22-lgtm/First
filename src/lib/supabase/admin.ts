import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

import type { Database } from "./database.types";

/**
 * Service-role client — bypasses RLS entirely. Only import this from
 * server-only code (Server Actions, Route Handlers) and only for operations
 * that genuinely need to act outside the calling user's own permissions,
 * like creating a new team member's login. Never expose this client or its
 * key to the browser.
 */
export function createAdminClient() {
  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

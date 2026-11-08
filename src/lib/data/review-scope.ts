import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who a data read is for. Normally the signed-in person's own organization,
 * through their own session. A preview review page passes the business's real
 * data instead (read only, service role), so the owner checks a change
 * against their own numbers rather than made-up ones.
 */
export interface DataScope {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any>;
  organizationId: string;
}

/** The business the review pages show: JS Landscaping, the first organization. */
export const REVIEW_ORGANIZATION_ID = process.env.REVIEW_ORGANIZATION_ID ?? "00000000-0000-0000-0000-000000000001";

/** Preview review pages only: the business's real data. Callers must check reviewPagesEnabled() first. */
export async function reviewScope(): Promise<DataScope> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  return { client: createAdminClient(), organizationId: REVIEW_ORGANIZATION_ID };
}

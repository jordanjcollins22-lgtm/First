"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import { getRealProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { normalizeWebsite, type WebsiteContent } from "@/lib/website";

/**
 * Publishing the website from the new layout. Owner only, checked against
 * the account actually signed in: this is what the business says about
 * itself to everybody who finds it. Saving is publishing.
 */
export async function publishWebsite(content: WebsiteContent): Promise<{ ok: true; publishedAt: string } | { ok: false; error: string }> {
  const me = await getRealProfile();
  if (!me) return { ok: false, error: "Not signed in." };
  if (!isOwnerLevel(me.roles)) return { ok: false, error: "Only the owner can publish the website." };

  const publishedAt = new Date().toISOString();
  const sb = (await createClient()) as unknown as SupabaseClient;
  const { error } = await sb.from("website_settings").upsert({
    organization_id: me.organization_id,
    content: normalizeWebsite(content),
    published_at: publishedAt,
    updated_at: publishedAt,
    updated_by: me.id,
  });
  if (error) {
    console.error("publishWebsite failed:", error);
    return { ok: false, error: "Couldn't publish. Has the website table been set up yet?" };
  }
  revalidatePath("/site");
  revalidatePath("/v2/marketing");
  return { ok: true, publishedAt };
}

import { after } from "next/server";

import { isSupabaseAdminConfigured } from "@/lib/env";
import { outboundBaseUrl } from "@/lib/base-url";
import { makeJobDraft } from "@/lib/data/social-photo-drafts";
import { writeDraftText } from "@/lib/social/photo-post-writer";

/**
 * Turn a finished job's crew photos into a social post draft, straight
 * after the crew submits them or a manager signs them off. Runs after the
 * response (the AI writer takes a few seconds and the crew shouldn't wait
 * on it), never throws, and never undoes the action that called it. The
 * posting cron's catch-up makes any draft this misses.
 */
export function queueJobDraft(jobId: string, organizationId: string): void {
  if (!isSupabaseAdminConfigured) return;
  try {
    after(async () => {
      try {
        const { createAdminClient } = await import("@/lib/supabase/admin");
        const bookingUrl = `${(await outboundBaseUrl()).replace(/\/$/, "")}/book`;
        await makeJobDraft(createAdminClient(), organizationId, jobId, { bookingUrl, writer: writeDraftText });
      } catch (err) {
        console.error("[social] job draft not made:", jobId, err);
      }
    });
  } catch (err) {
    console.error("[social] job draft not queued:", jobId, err);
  }
}

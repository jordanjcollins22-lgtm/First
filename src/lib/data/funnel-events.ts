import type { createAdminClient } from "@/lib/supabase/admin";
import type { FunnelStep } from "@/lib/funnel";

/**
 * One step of the client funnel, written down for the admin Funnel page.
 *
 * Best effort and never in the way: a client paying or booking must not
 * fail because a count could not be written, so this logs and moves on.
 */
export async function recordFunnelStep(
  admin: ReturnType<typeof createAdminClient>,
  input: { organizationId: string; step: FunnelStep; jobId?: string | null; visitId?: string | null; detail?: string | null }
): Promise<void> {
  if (input.step === "book_opened" || (!input.jobId && !input.visitId)) return;
  try {
    const { error } = await admin.from("funnel_events").insert({
      organization_id: input.organizationId,
      step: input.step,
      job_id: input.jobId ?? null,
      visit_id: input.visitId ?? null,
      detail: input.detail?.slice(0, 40) ?? null,
    });
    if (error) console.error("[funnel] step not recorded:", input.step, error.message);
  } catch (err) {
    console.error("[funnel] step not recorded:", input.step, err);
  }
}

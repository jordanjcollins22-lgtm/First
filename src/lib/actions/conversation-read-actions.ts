"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";

export type ReadResponse = { ok: true } | { ok: false; message: string };

/**
 * Saying a conversation has been dealt with without typing a reply.
 *
 * The common case is ringing the client back. Without this the inbox has no
 * way to be told that happened, so the conversation sits under "Needs a
 * reply" forever and the list stops meaning anything.
 *
 * Marked for the whole office rather than per person: a client waiting on an
 * answer is waiting on the business. Whoever cleared it is recorded, so the
 * next person can ask them rather than the client.
 */
export async function markConversationRead(
  jobId: string,
  channel: string,
  /** Everything up to here is dealt with. Defaults to now. */
  through?: string
): Promise<ReadResponse> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();
    const { error } = await supabase.from("conversation_reads").upsert(
      {
        job_id: jobId,
        channel,
        organization_id: organizationId,
        read_through: through ?? new Date().toISOString(),
        read_by: profile.id,
        read_by_name: profile.full_name || profile.email,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id,channel" }
    );
    if (error) return { ok: false, message: error.message };

    revalidatePath("/conversations");
    revalidatePath(`/conversations/job/${jobId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Couldn't mark that read." };
  }
}

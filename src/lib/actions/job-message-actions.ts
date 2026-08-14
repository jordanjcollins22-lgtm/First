"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import type { MessageChannel } from "@/types/domain";

/** A team member posting into either thread — internal (team-only) or
 * external (also visible to the client on the proposal page). */
export async function postJobMessage(jobId: string, channel: MessageChannel, body: string) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Write a message first.");

  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { error } = await supabase.from("job_messages").insert({
    job_id: jobId,
    organization_id: organizationId,
    channel,
    author_type: "team",
    author_profile_id: profile.id,
    author_name: profile.full_name || profile.email,
    body: trimmed,
  });
  if (error) throw error;

  revalidatePath(`/jobs/${jobId}`);
}

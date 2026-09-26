"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { jobThreadContext } from "@/lib/message-context";
import { messageDedupeKey, teamMessageText } from "@/lib/message-notify";
import { notifyJobTeam } from "@/lib/notifications";

/** The client's own message on the external thread — no logged-in user, so
 * this runs on the service-role client like the rest of the public flows. */
export async function postPublicClientMessage(
  token: string,
  authorName: string,
  body: string,
  /** What they were looking at when they wrote — an area of their proposal,
   * or the proposal itself. Snapshotted here rather than resolved later: an
   * area renamed next week does not change what they were asking about. */
  reference?: string | null
) {
  const trimmedBody = body.trim();
  if (!trimmedBody) throw new Error("Write a message first.");

  const admin = createAdminClient();
  const { data: proposal, error } = await admin
    .from("job_proposals")
    .select("job_id, organization_id")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!proposal) throw new Error("This proposal link isn't valid.");

  const { data: saved, error: insertError } = await admin
    .from("job_messages")
    .insert({
      job_id: proposal.job_id,
      organization_id: proposal.organization_id,
      channel: "external",
      author_type: "client",
      author_name: authorName.trim() || "Client",
      body: trimmedBody,
      reference_label: reference?.trim() || null,
      reference_kind: reference?.trim() ? "proposal" : null,
    })
    .select("id")
    .maybeSingle();
  if (insertError) throw insertError;

  // A client writing in used to notify nobody, so the answer waited until
  // somebody happened to open the job. Best-effort: their message is already
  // saved whether or not the text goes out.
  notifyTeamAboutClientMessage(
    proposal.job_id,
    authorName,
    trimmedBody,
    (saved as { id: string } | null)?.id ?? null,
    reference?.trim() || null
  ).catch(() => {});

  revalidatePath(`/proposal/${token}`);
  revalidatePath(`/jobs/${proposal.job_id}`);
  revalidatePath(`/conversations/job/${proposal.job_id}`);
  revalidatePath("/conversations");
}

async function notifyTeamAboutClientMessage(
  jobId: string,
  authorName: string,
  body: string,
  messageId: string | null,
  reference: string | null
): Promise<void> {
  const context = await jobThreadContext(jobId);
  await notifyJobTeam(
    jobId,
    "client_messages",
    teamMessageText({
      clientName: authorName.trim() || context?.clientName || "",
      // What they were asking about goes in the text too. A crew member
      // reading it on a phone should not have to open the app to find out
      // which area "can we skip that one?" meant.
      body: reference ? `(${reference}) ${body}` : body,
      link: context?.teamLink ?? null,
    }),
    { dedupeKey: messageId ? messageDedupeKey(messageId) : undefined }
  );
}

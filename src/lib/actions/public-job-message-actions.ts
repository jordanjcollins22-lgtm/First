"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { jobThreadContext } from "@/lib/message-context";
import { messageDedupeKey, teamMessageText } from "@/lib/message-notify";
import { notifyJobTeam } from "@/lib/notifications";

/** The client's own message on the external thread — no logged-in user, so
 * this runs on the service-role client like the rest of the public flows. */
export async function postPublicClientMessage(token: string, authorName: string, body: string) {
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
    (saved as { id: string } | null)?.id ?? null
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
  messageId: string | null
): Promise<void> {
  const context = await jobThreadContext(jobId);
  await notifyJobTeam(
    jobId,
    "client_messages",
    teamMessageText({
      clientName: authorName.trim() || context?.clientName || "",
      body,
      link: context?.teamLink ?? null,
    }),
    { dedupeKey: messageId ? messageDedupeKey(messageId) : undefined }
  );
}

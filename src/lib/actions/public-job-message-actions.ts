"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";

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

  const { error: insertError } = await admin.from("job_messages").insert({
    job_id: proposal.job_id,
    organization_id: proposal.organization_id,
    channel: "external",
    author_type: "client",
    author_name: authorName.trim() || "Client",
    body: trimmedBody,
  });
  if (insertError) throw insertError;

  revalidatePath(`/proposal/${token}`);
  revalidatePath(`/jobs/${proposal.job_id}`);
}

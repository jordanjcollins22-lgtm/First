"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { jobThreadContext } from "@/lib/message-context";
import { clientMessageText, internalNoteText, messageDedupeKey } from "@/lib/message-notify";
import { notifyJobTeam } from "@/lib/notifications";
import { sendSms, toE164 } from "@/lib/sms";
import { isTwilioConfigured } from "@/lib/env";
import type { MessageChannel } from "@/types/domain";

export async function postJobMessage(jobId: string, channel: MessageChannel, body: string) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Write a message first.");

  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { data: saved, error } = await supabase
    .from("job_messages")
    .insert({
      job_id: jobId,
      organization_id: organizationId,
      channel,
      author_type: "team",
      author_profile_id: profile.id,
      author_name: profile.full_name || profile.email,
      body: trimmed,
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;

  // Best-effort from here down: the message is saved, and a notification that
  // fails is never a reason to tell the sender their message didn't send.
  notifyAboutTeamMessage({
    jobId,
    channel,
    body: trimmed,
    messageId: (saved as { id: string } | null)?.id ?? null,
    authorName: profile.full_name || profile.email,
    authorProfileId: profile.id,
  }).catch(() => {});

  revalidatePath(`/jobs/${jobId}`);
  revalidatePath(`/conversations/job/${jobId}`);
  revalidatePath("/conversations");
}

async function notifyAboutTeamMessage(input: {
  jobId: string;
  channel: MessageChannel;
  body: string;
  messageId: string | null;
  authorName: string;
  authorProfileId: string;
}): Promise<void> {
  const context = await jobThreadContext(input.jobId);
  const dedupeKey = input.messageId ? messageDedupeKey(input.messageId) : undefined;

  if (input.channel === "external") {
    // Straight to the client's phone, signed with the business name and
    // carrying the link back to the thread so they can answer in one tap.
    const e164 = context?.clientPhone ? toE164(context.clientPhone) : null;
    if (!e164) {
      console.warn(
        `No text sent on job ${input.jobId}: ` +
          (context?.clientPhone
            ? `"${context.clientPhone}" is not a number this can dial.`
            : "the client has no phone number on file.")
      );
      return;
    }
    if (!isTwilioConfigured) {
      console.warn(
        `No text sent on job ${input.jobId}: no text provider is set up. ` +
          "Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER, then redeploy."
      );
      return;
    }
    await sendSms(
      e164,
      clientMessageText({
        businessName: context?.businessName ?? "",
        body: input.body,
        link: context?.clientLink ?? null,
      })
    );
    return;
  }

  // An internal note is for the rest of the crew on this job — everyone but
  // the person who just typed it.
  await notifyJobTeam(
    input.jobId,
    "team_messages",
    internalNoteText({
      authorName: input.authorName,
      jobLabel: context?.jobLabel ?? "",
      body: input.body,
      link: context?.teamLink ?? null,
    }),
    { dedupeKey, except: input.authorProfileId }
  );
}

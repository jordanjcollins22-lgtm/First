"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { notifyTeamMember } from "@/lib/notifications";
import type { AttachmentKind, ChannelNotifyChoice, TeamMessage } from "@/types/domain";
import { env, isTranscriptionConfigured } from "@/lib/env";

export type ChannelResult = { ok: true; id?: string } | { ok: false; message: string };

/** Carries the row back so the sender can show their own message straight
 * away rather than waiting on a refresh or a Realtime round trip. */
export type PostMessageResult = { ok: true; message: TeamMessage } | { ok: false; message: string };

function fail(error: { message: string; code?: string }): ChannelResult {
  return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };
}

function describe(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong.";
}

/** Whoever creates a group is added to it — a group you can't read the
 * moment you make it would be useless. */
export async function createTeamChannel(name: string, description: string): Promise<ChannelResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const trimmed = name.trim();
    if (!trimmed) return { ok: false, message: "Name this group." };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("team_channels")
      .insert({
        organization_id: organizationId,
        name: trimmed,
        description: description.trim() || null,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (error) return fail(error);

    const { error: memberError } = await supabase
      .from("team_channel_members")
      .insert({ channel_id: data.id, profile_id: profile.id });
    if (memberError) return fail(memberError);

    revalidatePath("/conversations");
    return { ok: true, id: data.id as string };
  } catch (err) {
    console.error("createTeamChannel failed:", err);
    return { ok: false, message: describe(err) };
  }
}

export async function setTeamChannelMember(
  channelId: string,
  profileId: string,
  isMember: boolean
): Promise<ChannelResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    if (isMember) {
      const { error } = await supabase
        .from("team_channel_members")
        .upsert({ channel_id: channelId, profile_id: profileId }, { onConflict: "channel_id,profile_id" });
      if (error) return fail(error);
    } else {
      const { error } = await supabase
        .from("team_channel_members")
        .delete()
        .eq("channel_id", channelId)
        .eq("profile_id", profileId);
      if (error) return fail(error);
    }

    revalidatePath("/conversations");
    revalidatePath(`/conversations/${channelId}`);
    return { ok: true };
  } catch (err) {
    console.error("setTeamChannelMember failed:", err);
    return { ok: false, message: describe(err) };
  }
}

export interface MessageAttachment {
  path: string;
  kind: AttachmentKind;
  name: string;
}

export async function postTeamMessage(
  channelId: string,
  body: string,
  attachment?: MessageAttachment
): Promise<PostMessageResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const trimmed = body.trim();
    // An attachment is a message on its own — a photo needs no caption.
    if (!trimmed && !attachment) return { ok: false, message: "Write a message first." };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();
    const { data: created, error } = await supabase
      .from("team_messages")
      .insert({
        channel_id: channelId,
        organization_id: organizationId,
        author_profile_id: profile.id,
        author_name: profile.full_name || profile.email,
        body: trimmed || null,
        attachment_path: attachment?.path ?? null,
        attachment_kind: attachment?.kind ?? null,
        attachment_name: attachment?.name ?? null,
      })
      .select()
      .single();
    // RLS blocks posting to a group you're not in, which surfaces here rather
    // than as a silent no-op.
    if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };

    const { data: channel } = await supabase.from("team_channels").select("name").eq("id", channelId).maybeSingle();
    const { data: members } = await supabase
      .from("team_channel_members")
      .select("profile_id, notify_override")
      .eq("channel_id", channelId);

    const summary =
      trimmed.slice(0, 120) ||
      `sent ${attachment?.kind === "audio" ? "a voice memo" : `a ${attachment?.kind ?? "message"}`}`;

    // Everyone but the sender, best-effort, honouring each person's choice
    // for this particular group: muted skips them outright, always overrides
    // their general Team group messages toggle, null follows it.
    await Promise.all(
      (members ?? [])
        .filter((m) => m.profile_id !== profile.id && m.notify_override !== false)
        .map((m) =>
          notifyTeamMember(
            m.profile_id,
            "team_messages",
            `${profile.full_name || profile.email} in ${channel?.name ?? "a group"}: ${summary}`,
            { overridesKindPreference: m.notify_override === true }
          ).catch(() => false)
        )
    );

    // Only the list of conversations needs rebuilding; the thread itself
    // updates from the returned row and Realtime. Revalidating the thread
    // too would replace the component's state mid-send, which is what made
    // a sender's own message vanish until they reopened the app.
    revalidatePath("/conversations");
    return { ok: true, message: created as unknown as TeamMessage };
  } catch (err) {
    console.error("postTeamMessage failed:", err);
    return { ok: false, message: describe(err) };
  }
}

export async function deleteTeamChannel(channelId: string): Promise<ChannelResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };
    if (!profile.roles.includes("admin")) {
      return { ok: false, message: "Only admins can delete a group." };
    }

    const supabase = await createClient();
    const { error } = await supabase.from("team_channels").delete().eq("id", channelId);
    if (error) return fail(error);

    revalidatePath("/conversations");
    return { ok: true };
  } catch (err) {
    console.error("deleteTeamChannel failed:", err);
    return { ok: false, message: describe(err) };
  }
}

/** A signed URL for one attachment. Storage enforces group membership on
 * read, so a non-member's request comes back empty rather than working. */
export async function getAttachmentUrl(path: string): Promise<string | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from("message-attachments")
      .createSignedUrl(path, 60 * 60);
    if (error) return null;
    return data?.signedUrl ?? null;
  } catch (err) {
    console.error("getAttachmentUrl failed:", err);
    return null;
  }
}

export type TranscribeResult = { ok: true; transcript: string } | { ok: false; message: string };

/**
 * Transcribes a voice memo and saves it onto the message, so it's readable
 * without playing it. Called right after the memo is sent; the memo is
 * already usable either way, so a failure here is reported but doesn't undo
 * anything.
 */
export async function transcribeVoiceMemo(messageId: string): Promise<TranscribeResult> {
  try {
    if (!isTranscriptionConfigured) {
      return { ok: false, message: "Transcription isn't set up on the server yet." };
    }

    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const supabase = await createClient();
    // RLS means this only returns a message from a group they're in.
    const { data: message } = await supabase
      .from("team_messages")
      .select("attachment_path, attachment_kind, attachment_name")
      .eq("id", messageId)
      .maybeSingle();
    if (!message?.attachment_path || message.attachment_kind !== "audio") {
      return { ok: false, message: "That message has no voice memo." };
    }

    const { data: file, error: downloadError } = await supabase.storage
      .from("message-attachments")
      .download(message.attachment_path);
    if (downloadError || !file) return { ok: false, message: "Couldn't read that recording." };

    const form = new FormData();
    form.append("file", file, message.attachment_name || "memo.webm");
    form.append("model", "whisper-1");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.openaiApiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("transcribeVoiceMemo: OpenAI returned", res.status, detail);
      return { ok: false, message: "Transcription failed — the memo is still playable." };
    }

    const json = (await res.json()) as { text?: string };
    const transcript = (json.text ?? "").trim();
    if (!transcript) return { ok: false, message: "Nothing was said in that recording." };

    const { error } = await supabase.from("team_messages").update({ transcript }).eq("id", messageId);
    if (error) return { ok: false, message: error.message };

    return { ok: true, transcript };
  } catch (err) {
    console.error("transcribeVoiceMemo failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : "Transcription failed." };
  }
}

/** Someone's own choice for one group. Muting a group they're not in makes
 * no sense, so this only touches their own membership row. */
export async function setChannelNotifyChoice(
  channelId: string,
  choice: ChannelNotifyChoice
): Promise<ChannelResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const override = choice === "always" ? true : choice === "muted" ? false : null;

    const supabase = await createClient();
    const { error } = await supabase
      .from("team_channel_members")
      .update({ notify_override: override })
      .eq("channel_id", channelId)
      .eq("profile_id", profile.id);
    if (error) return fail(error);

    revalidatePath("/notifications");
    revalidatePath(`/conversations/${channelId}`);
    return { ok: true };
  } catch (err) {
    console.error("setChannelNotifyChoice failed:", err);
    return { ok: false, message: describe(err) };
  }
}

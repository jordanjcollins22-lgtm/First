"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { notifyTeamMember } from "@/lib/notifications";
import type { TeamMessage } from "@/types/domain";

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

export async function postTeamMessage(channelId: string, body: string): Promise<PostMessageResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const trimmed = body.trim();
    if (!trimmed) return { ok: false, message: "Write a message first." };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();
    const { data: created, error } = await supabase
      .from("team_messages")
      .insert({
        channel_id: channelId,
        organization_id: organizationId,
        author_profile_id: profile.id,
        author_name: profile.full_name || profile.email,
        body: trimmed,
      })
      .select()
      .single();
    // RLS blocks posting to a group you're not in, which surfaces here rather
    // than as a silent no-op.
    if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };

    const { data: channel } = await supabase.from("team_channels").select("name").eq("id", channelId).maybeSingle();
    const { data: members } = await supabase
      .from("team_channel_members")
      .select("profile_id")
      .eq("channel_id", channelId);
    // Everyone but the sender, best-effort.
    await Promise.all(
      (members ?? [])
        .filter((m) => m.profile_id !== profile.id)
        .map((m) =>
          notifyTeamMember(
            m.profile_id,
            "team_messages",
            `${profile.full_name || profile.email} in ${channel?.name ?? "a group"}: ${trimmed.slice(0, 120)}`
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

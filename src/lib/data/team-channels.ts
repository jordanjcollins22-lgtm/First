import { createClient } from "@/lib/supabase/server";
import type { TeamChannelWithMembers, TeamMessage } from "@/types/domain";

/** Every group in the org with its roster and latest activity. Messages are
 * members-only at the RLS level, so lastMessage comes back null for a group
 * the viewer isn't in — the group itself stays visible so they can be added. */
export async function listTeamChannels(): Promise<TeamChannelWithMembers[]> {
  const supabase = await createClient();

  const { data: channels, error } = await supabase.from("team_channels").select("*").order("name");
  if (error) throw error;
  if (!channels || channels.length === 0) return [];

  const [{ data: members }, { data: messages }] = await Promise.all([
    supabase.from("team_channel_members").select("channel_id, profile_id"),
    supabase.from("team_messages").select("*").order("created_at", { ascending: false }),
  ]);

  const memberIdsByChannel = new Map<string, string[]>();
  for (const member of members ?? []) {
    const ids = memberIdsByChannel.get(member.channel_id) ?? [];
    ids.push(member.profile_id);
    memberIdsByChannel.set(member.channel_id, ids);
  }

  const statsByChannel = new Map<string, { lastMessage: TeamMessage; count: number }>();
  for (const raw of messages ?? []) {
    const message = raw as unknown as TeamMessage;
    const existing = statsByChannel.get(message.channel_id);
    if (existing) existing.count += 1;
    else statsByChannel.set(message.channel_id, { lastMessage: message, count: 1 });
  }

  return channels.map((channel) => {
    const stats = statsByChannel.get(channel.id);
    return {
      ...channel,
      memberIds: memberIdsByChannel.get(channel.id) ?? [],
      lastMessage: stats?.lastMessage ?? null,
      messageCount: stats?.count ?? 0,
    };
  }) as unknown as TeamChannelWithMembers[];
}

export async function getTeamChannel(
  channelId: string
): Promise<{ channel: TeamChannelWithMembers; messages: TeamMessage[] } | null> {
  const supabase = await createClient();

  const { data: channel, error } = await supabase.from("team_channels").select("*").eq("id", channelId).maybeSingle();
  if (error) throw error;
  if (!channel) return null;

  const [{ data: members }, { data: messages }] = await Promise.all([
    supabase.from("team_channel_members").select("profile_id").eq("channel_id", channelId),
    supabase.from("team_messages").select("*").eq("channel_id", channelId).order("created_at"),
  ]);

  const list = (messages ?? []) as unknown as TeamMessage[];
  return {
    channel: {
      ...channel,
      memberIds: (members ?? []).map((m) => m.profile_id),
      lastMessage: list[list.length - 1] ?? null,
      messageCount: list.length,
    } as unknown as TeamChannelWithMembers,
    messages: list,
  };
}

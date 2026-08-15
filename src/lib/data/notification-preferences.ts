import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { ChannelNotificationSetting, NotificationPreferences } from "@/types/domain";

export interface MyNotificationSettings {
  preferences: NotificationPreferences | null;
  phone: string | null;
  /** One row per internal group they're in, so each can be set separately. */
  channels: ChannelNotificationSetting[];
}

/** The signed-in person's own settings. Null preferences means they've never
 * opened this screen — treated as "off" everywhere. */
export async function getMyNotificationSettings(): Promise<MyNotificationSettings | null> {
  const profile = await getCurrentProfile();
  if (!profile) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("*")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (error) throw error;

  // Only the groups they're actually in — there's nothing to tune for a
  // group that can't notify them in the first place.
  const { data: memberships } = await supabase
    .from("team_channel_members")
    .select("channel_id, notify_override, team_channels(name)")
    .eq("profile_id", profile.id);

  const channels: ChannelNotificationSetting[] = ((memberships ?? []) as unknown as {
    channel_id: string;
    notify_override: boolean | null;
    team_channels: { name: string } | null;
  }[])
    .map((m) => ({
      channelId: m.channel_id,
      channelName: m.team_channels?.name ?? "Group",
      choice: m.notify_override === true ? ("always" as const) : m.notify_override === false ? ("muted" as const) : ("default" as const),
    }))
    .sort((a, b) => a.channelName.localeCompare(b.channelName));

  return {
    preferences: (data as unknown as NotificationPreferences) ?? null,
    phone: profile.phone,
    channels,
  };
}

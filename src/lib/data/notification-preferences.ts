import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { NotificationPreferences } from "@/types/domain";

export interface MyNotificationSettings {
  preferences: NotificationPreferences | null;
  phone: string | null;
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

  return { preferences: (data as unknown as NotificationPreferences) ?? null, phone: profile.phone };
}

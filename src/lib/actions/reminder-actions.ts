"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import type { Channel } from "@/lib/client-consent";
import type { ReminderKind } from "@/lib/client-reminders";

type Result = { ok: true } | { ok: false; error: string };

/** The master switch. Off until somebody here turns it on. */
export async function setClientRemindersEnabled(enabled: boolean): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ client_reminders_enabled: enabled })
    .eq("id", profile.organization_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/reminders");
  return { ok: true };
}

/** The hours a client may be written to, in their own clock. */
export async function setQuietHours(input: {
  timeZone: string;
  startHour: number;
  endHour: number;
}): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (input.startHour < 0 || input.startHour > 23) return { ok: false, error: "Pick an hour of the day." };
  if (input.endHour < 1 || input.endHour > 24) return { ok: false, error: "Pick an hour of the day." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      reminder_time_zone: input.timeZone,
      reminder_quiet_start: input.startHour,
      reminder_quiet_end: input.endHour,
    })
    .eq("id", profile.organization_id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/reminders");
  return { ok: true };
}

/** One reminder: on or off, on which channels, and how far from the thing. */
export async function saveReminderRule(input: {
  kind: ReminderKind;
  enabled: boolean;
  channels: Channel[];
  offsetsHours: number[];
}): Promise<Result> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Not signed in." };
  if (input.enabled && input.channels.length === 0) {
    return { ok: false, error: "Pick at least one of text or email, or switch it off." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("reminder_rules").upsert(
    {
      organization_id: profile.organization_id,
      kind: input.kind,
      enabled: input.enabled,
      channels: input.channels,
      offsets_hours: input.offsetsHours,
      updated_at: new Date().toISOString(),
      updated_by: profile.id,
    },
    { onConflict: "organization_id,kind" }
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/reminders");
  return { ok: true };
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { toE164 } from "@/lib/sms";

export type NotificationResult = { ok: true } | { ok: false; message: string };

export interface NotificationPreferencesInput {
  smsEnabled: boolean;
  appointmentReminders: boolean;
  clientMessages: boolean;
  proposalResponses: boolean;
  teamMessages: boolean;
  reminderHoursBefore: number;
}

/** Anyone can set their own — this is a personal setting, not an admin one. */
export async function saveNotificationPreferences(
  input: NotificationPreferencesInput
): Promise<NotificationResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    if (input.smsEnabled && !profile.phone?.trim()) {
      return { ok: false, message: "Add your mobile number below before turning texts on." };
    }

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();
    const { error } = await supabase.from("notification_preferences").upsert(
      {
        profile_id: profile.id,
        organization_id: organizationId,
        sms_enabled: input.smsEnabled,
        appointment_reminders: input.appointmentReminders,
        client_messages: input.clientMessages,
        proposal_responses: input.proposalResponses,
        team_messages: input.teamMessages,
        reminder_hours_before: Math.min(168, Math.max(1, Math.round(input.reminderHoursBefore) || 24)),
      },
      { onConflict: "profile_id" }
    );
    if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };

    revalidatePath("/notifications");
    return { ok: true };
  } catch (err) {
    console.error("saveNotificationPreferences failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : "Something went wrong." };
  }
}

/** Saving your own number. Uses the admin client scoped to the caller's own
 * id — the profiles policy doesn't let a non-admin update their own row, and
 * a phone number for notifications is theirs to set. */
export async function saveMyPhone(phone: string): Promise<NotificationResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Not signed in." };

    const trimmed = phone.trim();
    if (trimmed && !toE164(trimmed)) {
      return { ok: false, message: "That doesn't look like a valid mobile number." };
    }

    const admin = createAdminClient();
    const { error } = await admin.from("profiles").update({ phone: trimmed || null }).eq("id", profile.id);
    if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };

    revalidatePath("/notifications");
    return { ok: true };
  } catch (err) {
    console.error("saveMyPhone failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : "Something went wrong." };
  }
}

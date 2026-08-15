"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";

const PATH = "/admin/calendars";

export type CalendarResult = { ok: true } | { ok: false; message: string };

/** Managing calendars is an admin job — the same gate the settings page
 * itself uses, re-checked here so the action can't be called around it. */
async function requireAdmin(): Promise<string | null> {
  const profile = await getCurrentProfile();
  if (!profile) return "Not signed in.";
  if (!profile.roles.includes("admin")) return "Only admins can manage calendars.";
  return null;
}

function describe(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return "Something went wrong.";
}

export async function createCalendar(name: string, color: string, description: string): Promise<CalendarResult> {
  try {
    const denied = await requireAdmin();
    if (denied) return { ok: false, message: denied };

    const trimmed = name.trim();
    if (!trimmed) return { ok: false, message: "Name this calendar." };

    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();
    const { error } = await supabase.from("calendars").insert({
      organization_id: organizationId,
      name: trimmed,
      color: color.trim() || "#2f6d3c",
      description: description.trim() || null,
    });
    if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };

    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("createCalendar failed:", err);
    return { ok: false, message: describe(err) };
  }
}

export async function updateCalendar(
  id: string,
  input: { name: string; color: string; description: string }
): Promise<CalendarResult> {
  try {
    const denied = await requireAdmin();
    if (denied) return { ok: false, message: denied };

    const trimmed = input.name.trim();
    if (!trimmed) return { ok: false, message: "Name this calendar." };

    const supabase = await createClient();
    const { error } = await supabase
      .from("calendars")
      .update({
        name: trimmed,
        color: input.color.trim() || "#2f6d3c",
        description: input.description.trim() || null,
      })
      .eq("id", id);
    if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };

    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("updateCalendar failed:", err);
    return { ok: false, message: describe(err) };
  }
}

/** Memberships go with it (the foreign key cascades). */
export async function deleteCalendar(id: string): Promise<CalendarResult> {
  try {
    const denied = await requireAdmin();
    if (denied) return { ok: false, message: denied };

    const supabase = await createClient();
    const { error } = await supabase.from("calendars").delete().eq("id", id);
    if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };

    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("deleteCalendar failed:", err);
    return { ok: false, message: describe(err) };
  }
}

export async function setCalendarMember(
  calendarId: string,
  profileId: string,
  isMember: boolean
): Promise<CalendarResult> {
  try {
    const denied = await requireAdmin();
    if (denied) return { ok: false, message: denied };

    const supabase = await createClient();
    if (isMember) {
      const { error } = await supabase
        .from("calendar_members")
        .upsert({ calendar_id: calendarId, profile_id: profileId }, { onConflict: "calendar_id,profile_id" });
      if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };
    } else {
      const { error } = await supabase
        .from("calendar_members")
        .delete()
        .eq("calendar_id", calendarId)
        .eq("profile_id", profileId);
      if (error) return { ok: false, message: `${error.message}${error.code ? ` (${error.code})` : ""}` };
    }

    revalidatePath(PATH);
    return { ok: true };
  } catch (err) {
    console.error("setCalendarMember failed:", err);
    return { ok: false, message: describe(err) };
  }
}

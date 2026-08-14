"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";

export async function setWeeklyOff(dayOfWeek: number, off: boolean) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  if (dayOfWeek < 0 || dayOfWeek > 6) throw new Error("Invalid day of week.");

  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  if (off) {
    const { error } = await supabase
      .from("availability_weekly_off")
      .insert({ organization_id: organizationId, profile_id: profile.id, day_of_week: dayOfWeek });
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await supabase
      .from("availability_weekly_off")
      .delete()
      .eq("profile_id", profile.id)
      .eq("day_of_week", dayOfWeek);
    if (error) throw error;
  }
  revalidatePath("/evaluations");
}

export async function addDayOff(
  date: string,
  reason: string | null,
  startTime: string | null,
  endTime: string | null
) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date.");
  if (Boolean(startTime) !== Boolean(endTime)) {
    throw new Error("Set both a start and end time, or leave both blank for the whole day.");
  }
  if (startTime && endTime && startTime >= endTime) {
    throw new Error("End time must be after start time.");
  }

  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_days_off")
    .upsert(
      {
        organization_id: organizationId,
        profile_id: profile.id,
        date,
        start_time: startTime || null,
        end_time: endTime || null,
        reason: reason?.trim() || null,
      },
      { onConflict: "profile_id,date" }
    );
  if (error) throw error;
  revalidatePath("/evaluations");
}

export async function removeDayOff(date: string) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("availability_days_off")
    .delete()
    .eq("profile_id", profile.id)
    .eq("date", date);
  if (error) throw error;
  revalidatePath("/evaluations");
}

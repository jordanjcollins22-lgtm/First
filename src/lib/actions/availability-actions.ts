"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";

export interface WeeklyAvailabilityDayInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/** Replaces the caller's whole weekly availability in one go — set deliberately, not
 * a live per-click toggle. Days not included in `days` are treated as not available. */
export async function saveWeeklyAvailability(days: WeeklyAvailabilityDayInput[]) {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");

  const seen = new Set<number>();
  for (const d of days) {
    if (d.dayOfWeek < 0 || d.dayOfWeek > 6) throw new Error("Invalid day of week.");
    if (seen.has(d.dayOfWeek)) throw new Error("Each day can only be set once.");
    seen.add(d.dayOfWeek);
    if (!d.startTime || !d.endTime) throw new Error("Set a start and end time for every available day.");
    if (d.startTime >= d.endTime) throw new Error("End time must be after start time.");
  }

  const organizationId = await getCurrentOrganizationId();
  const supabase = await createClient();

  const { error: deleteError } = await supabase.from("availability_weekly").delete().eq("profile_id", profile.id);
  if (deleteError) throw deleteError;

  if (days.length > 0) {
    const { error: insertError } = await supabase.from("availability_weekly").insert(
      days.map((d) => ({
        organization_id: organizationId,
        profile_id: profile.id,
        day_of_week: d.dayOfWeek,
        start_time: d.startTime,
        end_time: d.endTime,
      }))
    );
    if (insertError) throw insertError;
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

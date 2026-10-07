"use server";

import { revalidatePath } from "next/cache";

import { normalizePhone } from "@/lib/check-ins/phone";
import { parseTimeOfDay } from "@/lib/check-ins/schedule";
import { ensureGhlContactId, sendImmediateCheckIn } from "@/lib/check-ins/service";
import { isGhlConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import type { TeamMember } from "@/types/domain";

export interface ActionResult {
  error?: string;
}

export async function createTeamMember(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  const phone = normalizePhone(String(formData.get("phone") ?? ""));
  if (!phone) return { error: "Enter a valid phone number, e.g. (555) 123-4567." };

  const { data, error } = await supabase
    .from("team_members")
    .insert({
      name,
      phone,
      role: String(formData.get("role") ?? "").trim() || null,
      timezone: String(formData.get("timezone") ?? "America/New_York"),
      is_manager: formData.get("is_manager") === "on",
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") return { error: "A team member with that phone number already exists." };
    throw error;
  }

  // Link them to a GoHighLevel contact now so the first check-in is instant.
  // If GHL is down, the first send retries this.
  if (isGhlConfigured()) {
    try {
      await ensureGhlContactId(supabase, data as unknown as TeamMember);
    } catch (err) {
      console.error("[team] GHL contact upsert failed; will retry on first send", err);
    }
  }

  revalidatePath("/team");
  return {};
}

export async function deactivateTeamMember(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("team_members").update({ active: false }).eq("id", id);
  if (error) throw error;
  revalidatePath("/team");
}

export async function createCheckInSchedule(formData: FormData): Promise<ActionResult> {
  const supabase = await createClient();

  const teamMemberId = String(formData.get("team_member_id") ?? "");
  const timeOfDay = String(formData.get("time_of_day") ?? "");
  if (!parseTimeOfDay(timeOfDay)) return { error: "Pick a time for the check-in." };
  const days = formData.getAll("days_of_week").map(Number).filter((d) => d >= 0 && d <= 6);
  if (days.length === 0) return { error: "Pick at least one day." };
  const message = String(formData.get("message") ?? "").trim();
  if (!message) return { error: "Message is required." };

  const { error } = await supabase.from("check_in_schedules").insert({
    team_member_id: teamMemberId,
    job_id: String(formData.get("job_id") ?? "") || null,
    label: String(formData.get("label") ?? "").trim() || "Check-in",
    days_of_week: days,
    time_of_day: timeOfDay,
    message,
    response_window_minutes: Math.max(5, Number(formData.get("response_window_minutes") ?? 30) || 30),
  });
  if (error) throw error;

  revalidatePath("/team");
  return {};
}

export async function deleteCheckInSchedule(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("check_in_schedules").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/team");
}

export async function sendCheckInNow(teamMemberId: string): Promise<ActionResult> {
  if (!isGhlConfigured()) return { error: "GoHighLevel isn't configured yet (GHL_API_KEY / GHL_LOCATION_ID)." };

  const supabase = await createClient();
  const { data: member, error } = await supabase
    .from("team_members")
    .select("*")
    .eq("id", teamMemberId)
    .single();
  if (error) throw error;

  const result = await sendImmediateCheckIn(
    supabase,
    member as unknown as TeamMember,
    "Hey {name}, quick check-in: how's it going and are you on schedule?"
  );

  revalidatePath("/team");
  revalidatePath("/check-ins");
  return result.ok ? {} : { error: result.error };
}

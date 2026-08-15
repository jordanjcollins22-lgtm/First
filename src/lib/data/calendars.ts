import { createClient } from "@/lib/supabase/server";
import type { CalendarWithMembers } from "@/types/domain";

/** Every calendar in the org with its assigned people, for the settings
 * screen. Two queries rather than a join so an empty calendar still comes
 * back with an empty roster instead of dropping out. */
export async function listCalendars(): Promise<CalendarWithMembers[]> {
  const supabase = await createClient();

  const { data: calendars, error } = await supabase.from("calendars").select("*").order("name");
  if (error) throw error;
  if (!calendars || calendars.length === 0) return [];

  const { data: members, error: membersError } = await supabase
    .from("calendar_members")
    .select("calendar_id, profile_id");
  if (membersError) throw membersError;

  const memberIdsByCalendar = new Map<string, string[]>();
  for (const member of members ?? []) {
    const ids = memberIdsByCalendar.get(member.calendar_id) ?? [];
    ids.push(member.profile_id);
    memberIdsByCalendar.set(member.calendar_id, ids);
  }

  return calendars.map((calendar) => ({
    ...calendar,
    memberIds: memberIdsByCalendar.get(calendar.id) ?? [],
  })) as unknown as CalendarWithMembers[];
}

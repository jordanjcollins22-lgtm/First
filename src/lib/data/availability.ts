import { createClient } from "@/lib/supabase/server";
import type { DayOff, WeeklyOff } from "@/types/domain";

/** Every weekly-off row in the org — small table, cheap to fetch in full. */
export async function listWeeklyOff(): Promise<WeeklyOff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("availability_weekly_off").select("*");
  if (error) throw error;
  return (data ?? []) as unknown as WeeklyOff[];
}

/** Days off within [startDate, endDate] (inclusive, "YYYY-MM-DD"), across the whole org. */
export async function listDaysOff(startDate: string, endDate: string): Promise<DayOff[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("availability_days_off")
    .select("*")
    .gte("date", startDate)
    .lte("date", endDate);
  if (error) throw error;
  return (data ?? []) as unknown as DayOff[];
}

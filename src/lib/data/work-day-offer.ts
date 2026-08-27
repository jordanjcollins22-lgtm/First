import { createAdminClient } from "@/lib/supabase/admin";
import { describeWeather, fetchForecasts } from "@/lib/weather";
import {
  buildWorkDays,
  OFFER_DAYS,
  WEATHER_WINDOW_DAYS,
  type DayWeather,
  type WorkDayOption,
} from "@/lib/work-days";

/**
 * The days we are willing to offer one client, with the forecast on them.
 *
 * Everything here is derived at read time. A table of "available days" would
 * be wrong within a day of being written, because the crew's diary and the
 * forecast both move without anybody remembering to update it.
 */
export interface WorkDayOffer {
  today: string;
  earliest: string;
  days: WorkDayOption[];
  /** Already picked, on an earlier visit or another device. */
  chosen: string | null;
}

/** Today where the crew is, not where the server is. */
function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export async function offeredWorkDays(input: {
  jobId: string;
  organizationId: string;
  /** The first day the payment path allows, when it is not today. */
  earliest?: string | null;
  chosen?: string | null;
}): Promise<WorkDayOffer> {
  const admin = createAdminClient();
  const today = todayKey();
  const earliest = input.earliest && input.earliest > today ? input.earliest : today;

  // Where the work is, so the forecast is for their street rather than for
  // the middle of the county.
  const { data: job } = await admin
    .from("jobs")
    .select("property_id")
    .eq("id", input.jobId)
    .maybeSingle();
  const { data: property } = job
    ? await admin.from("properties").select("lat, lng").eq("id", job.property_id).maybeSingle()
    : { data: null };

  // What the crew is already committed to. Jobs that were cancelled or are
  // finished do not hold a day.
  const horizon = new Date(`${earliest}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + OFFER_DAYS);
  // Jobs carry no organisation of their own, so the diary is reached through
  // the property's customer. An inner join keeps another company's work out
  // of this client's calendar.
  const { data: booked } = await admin
    .from("jobs")
    .select("project_start_date, status, properties!inner(customers!inner(organization_id))")
    .eq("properties.customers.organization_id", input.organizationId)
    .gte("project_start_date", today)
    .lte("project_start_date", horizon.toISOString().slice(0, 10));

  const bookedDays = ((booked ?? []) as unknown as {
    project_start_date: string | null;
    status: string;
  }[])
    .filter((j) => j.project_start_date && j.status !== "cancelled" && j.status !== "completed")
    .map((j) => j.project_start_date as string);

  let weather: DayWeather[] = [];
  if (property?.lat != null && property?.lng != null) {
    try {
      const [forecast] = await fetchForecasts(
        [{ id: input.jobId, name: "Property", lat: property.lat, lng: property.lng }],
        WEATHER_WINDOW_DAYS
      );
      weather = (forecast?.days ?? []).map((day) => ({
        date: day.date,
        precipChance: day.precipChance,
        code: day.code,
        label: describeWeather(day.code),
      }));
    } catch {
      // No forecast is not a reason to refuse somebody a date. They get the
      // days without weather on them, which is what happens past the horizon
      // anyway.
    }
  }

  return {
    today,
    earliest,
    chosen: input.chosen ?? null,
    days: buildWorkDays({ today, earliest, booked: bookedDays, weather }),
  };
}

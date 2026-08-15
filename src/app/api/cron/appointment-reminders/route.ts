import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTeamMember } from "@/lib/notifications";
import { env, isSupabaseAdminConfigured } from "@/lib/env";

/**
 * Texts each person an "evaluation coming up" reminder, however many hours
 * ahead they asked for. Meant to be hit on a schedule (Vercel Cron, or any
 * scheduler that can send a header).
 *
 * vercel.json runs this once a day, because Vercel's Hobby plan rejects any
 * deployment whose cron runs more often than that. A lead time is therefore
 * only as precise as the run interval: on a daily schedule, anything under
 * ~24 hours won't reliably fire. On a paid plan, change the schedule to
 * "0 * * * *" for hourly and short lead times start working.
 *
 * Sends are recorded in notification_log keyed by job, so running more often
 * than needed — or twice at once — still only texts a person once per
 * appointment.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  // Vercel Cron sends this automatically; anything else must supply it.
  const secret = env.cronSecret;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();

  // Who has opted in to receiving reminders at all.
  const { data: prefs } = await admin
    .from("notification_preferences")
    .select("profile_id")
    .eq("sms_enabled", true)
    .eq("appointment_reminders", true);
  if (!prefs || prefs.length === 0) return NextResponse.json({ sent: 0 });

  // How far ahead to remind is the calendar's call, not the person's.
  // Evaluations live on each org's built-in Evaluations calendar, so that
  // calendar's settings govern these reminders.
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, organization_id")
    .in("id", prefs.map((p) => p.profile_id));
  const orgByProfile = new Map((profiles ?? []).map((p) => [p.id, p.organization_id]));

  const { data: calendars } = await admin
    .from("calendars")
    .select("organization_id, reminders_enabled, reminder_hours_before")
    .eq("is_system", true);
  const calendarByOrg = new Map((calendars ?? []).map((c) => [c.organization_id, c]));

  const leadHoursByProfile = new Map<string, number>();
  for (const pref of prefs) {
    const calendar = calendarByOrg.get(orgByProfile.get(pref.profile_id) ?? "");
    // No Evaluations calendar yet (migration 0065 not run) falls back to 24h.
    if (calendar && !calendar.reminders_enabled) continue;
    leadHoursByProfile.set(pref.profile_id, calendar?.reminder_hours_before ?? 24);
  }
  if (leadHoursByProfile.size === 0) return NextResponse.json({ sent: 0 });

  const now = Date.now();
  // One window wide enough to cover every calendar's lead time, then filtered
  // per person below — cheaper than a query each.
  const maxHours = Math.max(...leadHoursByProfile.values());
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, name, assigned_to, evaluation_date, evaluation_status, property_id")
    .not("evaluation_date", "is", null)
    .neq("evaluation_status", "completed")
    .gte("evaluation_date", new Date(now).toISOString())
    .lte("evaluation_date", new Date(now + maxHours * 3600_000).toISOString());
  if (!jobs || jobs.length === 0) return NextResponse.json({ sent: 0 });

  const addressByProperty = new Map<string, string>();
  const propertyIds = Array.from(new Set(jobs.map((j) => j.property_id)));
  const { data: properties } = await admin.from("properties").select("id, address").in("id", propertyIds);
  for (const property of properties ?? []) addressByProperty.set(property.id, property.address);

  let sent = 0;
  for (const job of jobs) {
    if (!job.assigned_to || !job.evaluation_date) continue;
    const leadHours = leadHoursByProfile.get(job.assigned_to);
    if (leadHours == null) continue;

    const hoursAway = (new Date(job.evaluation_date).getTime() - now) / 3600_000;
    if (hoursAway > leadHours) continue;

    const when = new Date(job.evaluation_date).toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    const address = addressByProperty.get(job.property_id) ?? job.name;
    const didSend = await notifyTeamMember(
      job.assigned_to,
      "appointment_reminders",
      `Reminder: evaluation at ${address} on ${when}.`,
      { dedupeKey: job.id }
    ).catch(() => false);
    if (didSend) sent += 1;
  }

  return NextResponse.json({ sent });
}

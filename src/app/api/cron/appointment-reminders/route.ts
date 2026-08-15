import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { notifyTeamMember } from "@/lib/notifications";
import { env, isSupabaseAdminConfigured } from "@/lib/env";

/**
 * Texts each person an "evaluation coming up" reminder, however many hours
 * ahead they asked for. Meant to be hit on a schedule (Vercel Cron, or any
 * scheduler that can send a header) — roughly hourly is right, since the
 * per-person lead time is only accurate to the run interval.
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

  const { data: prefs } = await admin
    .from("notification_preferences")
    .select("profile_id, reminder_hours_before")
    .eq("sms_enabled", true)
    .eq("appointment_reminders", true);
  if (!prefs || prefs.length === 0) return NextResponse.json({ sent: 0 });

  const now = Date.now();
  // One window wide enough to cover everybody's lead time, then filtered
  // per person below — cheaper than a query each.
  const maxHours = Math.max(...prefs.map((p) => p.reminder_hours_before));
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
    const pref = prefs.find((p) => p.profile_id === job.assigned_to);
    if (!pref) continue;

    const hoursAway = (new Date(job.evaluation_date).getTime() - now) / 3600_000;
    if (hoursAway > pref.reminder_hours_before) continue;

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

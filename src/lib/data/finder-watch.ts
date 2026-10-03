import type { createAdminClient } from "@/lib/supabase/admin";
import { notifyTeamMember } from "@/lib/notifications";
import { finderAlert, minutesIntoHours, type FinderAlert } from "@/lib/finder-watch";
import { localClock, withinActiveHours } from "@/lib/outreach-agent";
import { TOOLS_OWNER_EMAILS } from "@/lib/tool-editors";
import { BUSINESS_TIME_ZONE, dateKeyIn, zonedToUtc } from "@/lib/time-zone";

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Tells the owner when the post finder has stopped, stopped reading, or
 * reads posts with no links. Run on the finder's server timer. One text per
 * stop, keyed on when it stopped, so a laptop asleep all afternoon is one
 * message, not one every half hour. Never throws: a watch that fails says
 * nothing rather than taking the timer down with it.
 */
export async function watchFinder(admin: Admin, organizationId: string, now: Date = new Date()): Promise<FinderAlert | null> {
  try {
    const { data: row } = await admin
      .from("outreach_agent_settings")
      .select("paused_until, active_from, active_to, updated_at, extension_seen_at, last_look_at")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!row) return null;

    const clockNow = localClock(now, BUSINESS_TIME_ZONE);
    const paused = Boolean(row.paused_until && new Date(row.paused_until).getTime() > now.getTime());
    const shouldRun = !paused && withinActiveHours(clockNow, row.active_from, row.active_to);
    // Pressing Start saves the settings: the minutes since then count as
    // starting up, the same as the first minutes of the day.
    const sinceSaved = (now.getTime() - new Date(row.updated_at).getTime()) / 60_000;
    const minutesRunning = Math.min(minutesIntoHours(clockNow, row.active_from), Number.isFinite(sinceSaved) ? sinceSaved : 0);

    const today = dateKeyIn(now);
    const dayStart = zonedToUtc(today, "00:00").toISOString();
    const posts = () =>
      admin
        .from("outreach_seen_posts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("added_by", null)
        .eq("matched", true)
        .gte("created_at", dayStart);
    const [{ count: matchedToday }, { count: linkedToday }] = await Promise.all([posts(), posts().neq("url", "")]);

    const alert = finderAlert({
      now,
      shouldRun,
      minutesRunning,
      extensionSeenAt: row.extension_seen_at,
      lastLookAt: row.last_look_at,
      matchedToday: matchedToday ?? 0,
      linkedToday: linkedToday ?? 0,
      today,
      timeZone: BUSINESS_TIME_ZONE,
    });
    if (!alert) return null;

    const { data: owners } = await admin
      .from("profiles")
      .select("id, email")
      .eq("organization_id", organizationId)
      .in("email", TOOLS_OWNER_EMAILS);
    await Promise.all(
      (owners ?? []).map((owner) =>
        // The owner asked for this one: it goes whatever their general alert switches say.
        notifyTeamMember(owner.id, "finder_stopped", alert.text, { dedupeKey: alert.dedupeKey, overridesKindPreference: true }).catch(() => false)
      )
    );
    return alert;
  } catch (err) {
    console.error("watchFinder failed:", err);
    return null;
  }
}

import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { outboundReady, sendOutbound } from "@/lib/email/outbound";
import { personOpenTime, sellingTeam } from "@/lib/data/open-time";
import { blockLabel, describePlay, minutesLabel, playFor, verdictLabel } from "@/lib/open-time";
import { dateKeyIn } from "@/lib/time-zone";
import { log, maskEmail } from "@/lib/log";

/**
 * The morning email to the people who sell.
 *
 * What is booked today, the open hours between, a play for each, and how
 * the last week went. Sent once a day, before the first visit, from the
 * business's own Gmail. Somebody booked solid gets a shorter one.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  const refused = authorizeCron(request, "team-reminders");
  if (refused) return refused;
  const admin = createAdminClient();
  const day = dateKeyIn(new Date());
  const { data: orgs } = await admin.from("organizations").select("id, name, public_base_url");
  const counts = { sent: 0, skipped: 0, failed: 0 };

  for (const org of orgs ?? []) {
    const can = await outboundReady(org.id);
    if (!can.ready) {
      log.warn("team.reminder.not_ready", { organizationId: org.id, why: can.why });
      continue;
    }
    const team = await sellingTeam(admin, org.id);
    for (const person of team) {
      if (!person.email) continue;
      const { data: already } = await admin
        .from("team_reminder_log")
        .select("id")
        .eq("profile_id", person.id)
        .eq("day", day)
        .eq("kind", "open_time")
        .maybeSingle();
      if (already) {
        counts.skipped += 1;
        continue;
      }

      const me = await personOpenTime(admin, person, day);
      const first = person.name.split(" ")[0];
      const base = (org.public_base_url ?? "https://app.jslandscapingmd.com").replace(/\/$/, "");
      const lines: string[] = [`Hi ${first},`, ""];
      if (me.appointments.length === 0) {
        lines.push("No evaluations booked today, so the whole day is for getting the next ones.");
      } else {
        lines.push(`${me.appointments.length} evaluation${me.appointments.length === 1 ? "" : "s"} today. Open time between them: ${minutesLabel(me.score.openMinutes)}.`);
      }
      lines.push("");
      for (const b of me.blocks) {
        lines.push(`${blockLabel(b)} (${minutesLabel(b.minutes)}): ${describePlay(playFor(b.minutes))}`);
      }
      if (me.blocks.length > 0) lines.push("");
      lines.push(
        `Last 7 days: ${minutesLabel(me.week.openMinutes)} open, ${me.week.score.actions} actions` +
          (me.week.score.perOpenHour != null ? `, ${me.week.score.perOpenHour} an open hour` : "") +
          `, ${me.week.counts.bookings} booked from your links. ${verdictLabel(me.week.score.verdict)}.`
      );
      lines.push("", `Start here: ${base}/admin/outreach`, "", org.name);

      const sent = await sendOutbound({
        organizationId: org.id,
        to: person.email,
        toName: person.name,
        subject: me.score.openMinutes > 0 ? `Today: ${minutesLabel(me.score.openMinutes)} open to book the next jobs` : "Today: booked solid",
        text: lines.join("\n"),
        fromName: org.name,
      });
      if (sent.ok) {
        await admin.from("team_reminder_log").insert({ organization_id: org.id, profile_id: person.id, day, kind: "open_time", detail: `${sent.via}:${sent.id}` });
        counts.sent += 1;
        log.info("team.reminder.sent", { profileId: person.id, to: maskEmail(person.email), day });
      } else {
        counts.failed += 1;
        log.warn("team.reminder.failed", { profileId: person.id, error: sent.message });
      }
    }
  }
  return NextResponse.json({ ok: true, day, ...counts });
}

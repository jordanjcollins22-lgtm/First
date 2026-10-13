import type { SupabaseClient } from "@supabase/supabase-js";

import {
  evaluationStepsToGo,
  localDay,
  offsetsToGo,
  STEP_LABEL,
  whenText,
  zonedTime,
  type Automation,
  type AutomationPerson,
  type EvaluationStep,
} from "@/lib/automations";
import { mergeRules, type ReminderRule } from "@/lib/client-reminders";
import { sellingTeam } from "@/lib/data/open-time";

/**
 * Every automated message the business sends, and who is in each one right
 * now, read the way the senders read it (cron/client-reminders,
 * evaluation_sequence_due(), cron/appointment-reminders, cron/team-reminders,
 * cron/crew-checkin). Read-only, under the signed-in owner's own access.
 */

type Row = Record<string, unknown>;
type Customer = { id?: string; name?: string | null; email?: string | null; phone?: string | null; do_not_contact?: boolean | null };

const HOUR = 3600_000;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const customerOf = (j: Row): Customer => ((j.property as Row | null)?.customer as Customer | null) ?? {};
const nameOf = (c: Customer, fallback: unknown) => c.name?.trim() || String(fallback ?? "") || "Unnamed client";

/** Log rows for these references, a slice at a time so the request stays short. */
async function logsFor(sb: SupabaseClient, ids: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await sb.from("client_message_log").select("dedupe_key").in("reference_id", ids.slice(i, i + 150));
    for (const r of data ?? []) if (r.dedupe_key) keys.add(String(r.dedupe_key));
  }
  return keys;
}

export async function loadAutomations(sb: SupabaseClient, organizationId: string): Promise<{ sales: Automation[]; operations: Automation[] }> {
  const now = new Date();
  const iso = (ms: number) => new Date(ms).toISOString();
  const custSelect = "property:properties!inner(customer:customers!inner(id,name,email,phone,do_not_contact,organization_id))";

  const [org, rulesRes, stepsRes, consentRes, calRes, evalJobsRes, startJobsRes, proposalsRes, team, sessionsRes] = await Promise.all([
    sb.from("organizations").select("client_reminders_enabled,reminder_time_zone").eq("id", organizationId).maybeSingle(),
    sb.from("reminder_rules").select("kind,enabled,channels,offsets_hours").eq("organization_id", organizationId),
    sb.from("evaluation_sequence_steps").select("step,enabled").eq("organization_id", organizationId),
    sb.from("client_consent").select("customer_id,channel").eq("organization_id", organizationId).eq("state", "revoked"),
    sb.from("calendars").select("reminders_enabled,reminder_hours_before").eq("organization_id", organizationId).eq("is_system", true).maybeSingle(),
    sb.from("jobs")
      .select(`id,name,evaluation_date,evaluation_status,created_at,assigned_to,${custSelect}`)
      .eq("property.customer.organization_id", organizationId)
      .is("cancelled_at", null)
      .gte("evaluation_date", iso(now.getTime() - 3 * 24 * HOUR))
      .lte("evaluation_date", iso(now.getTime() + 60 * 24 * HOUR))
      .order("evaluation_date")
      .limit(1000),
    sb.from("jobs")
      .select(`id,name,project_start_date,${custSelect}`)
      .eq("property.customer.organization_id", organizationId)
      .is("cancelled_at", null)
      .is("completed_at", null)
      .gte("project_start_date", localDay(now, "America/New_York"))
      .order("project_start_date")
      .limit(1000),
    sb.from("job_proposals")
      .select("id,sent_at,job:jobs!inner(id,name,cancelled_at,property:properties!inner(customer:customers!inner(id,name,email,do_not_contact)))")
      .eq("organization_id", organizationId)
      .eq("status", "sent")
      .not("sent_at", "is", null)
      .gte("created_at", iso(now.getTime() - 60 * 24 * HOUR))
      .is("job.cancelled_at", null)
      .limit(500),
    sellingTeam(sb as never, organizationId).catch(() => []),
    sb.from("job_work_sessions")
      .select("job_id,jobs(name,status,job_crew(profile_id,profiles!job_crew_profile_id_fkey(full_name,email)))")
      .eq("organization_id", organizationId)
      .lte("starts_on", localDay(now, "America/New_York"))
      .gte("ends_on", localDay(now, "America/New_York"))
      .not("status", "in", "(cancelled,done)"),
  ]);

  const tz = (org.data?.reminder_time_zone as string | undefined) || "America/New_York";
  const clientOn = Boolean(org.data?.client_reminders_enabled);
  const offNote = "Client messages are switched off for the business, so nobody is being sent these. The list is who would be.";
  const rules = mergeRules(
    (rulesRes.data ?? []).map((r) => ({ kind: r.kind, enabled: r.enabled, channels: r.channels, offsetsHours: r.offsets_hours })) as Partial<ReminderRule>[]
  );
  const rule = (k: ReminderRule["kind"]) => rules.find((r) => r.kind === k)!;
  const stepOff = new Set((stepsRes.data ?? []).filter((s) => s.enabled === false).map((s) => s.step as EvaluationStep));
  const revoked = new Set((consentRes.data ?? []).map((c) => `${c.customer_id}:${c.channel}`));
  const canEmail = (c: Customer) => !c.do_not_contact && EMAIL_RE.test(c.email ?? "") && !revoked.has(`${c.id}:email`);
  const canText = (c: Customer) => !c.do_not_contact && Boolean(c.phone?.trim()) && !revoked.has(`${c.id}:sms`);
  const when = (at: Date) => whenText(at, now, tz);
  const visitTime = (at: Date) => at.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const evalJobs = ((evalJobsRes.data ?? []) as Row[]).filter((j) => j.evaluation_status !== "cancelled" && j.evaluation_status != null);
  const startJobs = (startJobsRes.data ?? []) as Row[];
  const proposals = (proposalsRes.data ?? []) as Row[];
  const sent = await logsFor(sb, [...evalJobs.map((j) => String(j.id)), ...startJobs.map((j) => String(j.id)), ...proposals.map((p) => String(p.id))]);

  // Evaluation emails: the five-step series.
  const evalEmails: AutomationPerson[] = [];
  for (const j of evalJobs) {
    const c = customerOf(j);
    if (!canEmail(c)) continue;
    const id = String(j.id);
    const done = new Set(
      (["booked", "two_days", "day_before", "morning_of", "after"] as EvaluationStep[]).filter((s) => sent.has(`evaluation_sequence:${id}:${s}:email`))
    );
    if (sent.has(`evaluation_confirmed:${id}:0:email`)) done.add("booked");
    const e = new Date(String(j.evaluation_date));
    const togo = evaluationStepsToGo({ evaluationAt: e, bookedAt: new Date(String(j.created_at)), now, timeZone: tz, sent: done, disabled: stepOff });
    if (!togo.length) continue;
    evalEmails.push({ name: nameOf(c, j.name), why: `Evaluation ${visitTime(e)}`, next: `Next: ${STEP_LABEL[togo[0].step]} email, ${when(togo[0].at)}${togo.length > 1 ? ` (${togo.length - 1} more after)` : ""}` });
  }

  // Evaluation reminder text.
  const evalRule = rule("evaluation_reminder");
  const evalTexts: AutomationPerson[] = [];
  for (const j of evalJobs) {
    const c = customerOf(j);
    const e = new Date(String(j.evaluation_date));
    if (e <= now || !canText(c) || !evalRule.channels.includes("sms")) continue;
    const done = new Set(evalRule.offsetsHours.filter((o) => sent.has(`evaluation_reminder:${j.id}:${o}:sms`)));
    const togo = offsetsToGo(e, evalRule.offsetsHours, now, done);
    if (togo.length) evalTexts.push({ name: nameOf(c, j.name), why: `Evaluation ${visitTime(e)}`, next: `Text ${when(togo[0].at)}` });
  }

  // Proposal follow-up emails.
  const propRule = rule("proposal_follow_up");
  const followUps: AutomationPerson[] = [];
  for (const p of proposals) {
    const job = (p.job as Row | null) ?? {};
    const c = customerOf(job);
    if (!canEmail(c)) continue;
    const at = new Date(String(p.sent_at));
    const done = new Set(propRule.offsetsHours.filter((o) => sent.has(`proposal_follow_up:${p.id}:${o}:email`)));
    const togo = offsetsToGo(at, propRule.offsetsHours, now, done);
    if (togo.length) followUps.push({ name: nameOf(c, job.name), why: `Proposal sent ${visitTime(at)}, not answered`, next: `Follow-up email ${when(togo[0].at)}${togo.length > 1 ? " (1 more after)" : ""}` });
  }

  // Job start text.
  const startRule = rule("job_start_reminder");
  const starts: AutomationPerson[] = [];
  for (const j of startJobs) {
    const c = customerOf(j);
    if (!canText(c) || !startRule.channels.includes("sms")) continue;
    const anchor = zonedTime(String(j.project_start_date), 8, 0, "America/New_York");
    const done = new Set(startRule.offsetsHours.filter((o) => sent.has(`job_start_reminder:${j.id}:${o}:sms`)));
    const togo = offsetsToGo(anchor, startRule.offsetsHours, now, done);
    const day = new Date(`${j.project_start_date}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
    if (togo.length) starts.push({ name: nameOf(c, j.name), why: `Job starts ${day}`, next: `Text ${when(togo[0].at)}` });
  }

  // Evaluator reminders: every upcoming visit with somebody assigned.
  const calOn = calRes.data?.reminders_enabled !== false;
  const lead = Number(calRes.data?.reminder_hours_before ?? 24) || 24;
  const teamNames = new Map((team as { id: string; name: string }[]).map((t) => [t.id, t.name]));
  const evaluatorReminders: AutomationPerson[] = evalJobs
    .filter((j) => j.assigned_to && new Date(String(j.evaluation_date)) > now && j.evaluation_status !== "completed")
    .map((j) => {
      const e = new Date(String(j.evaluation_date));
      return {
        name: teamNames.get(String(j.assigned_to)) ?? "Evaluator",
        why: `Visit with ${nameOf(customerOf(j), j.name)} ${visitTime(e)}`,
        next: `Reminder ${when(new Date(Math.max(now.getTime(), e.getTime() - lead * HOUR)))}`,
      };
    });

  // Morning open-time email to everybody who sells.
  const openTime: AutomationPerson[] = (team as { name: string; email: string | null }[])
    .filter((t) => t.email)
    .map((t) => ({ name: t.name, why: "Sells or does evaluations", next: "Every morning, Monday to Saturday" }));

  // Crew check-in alert: crew on today's work days.
  const crewToday = new Map<string, AutomationPerson>();
  for (const s of (sessionsRes.data ?? []) as Row[]) {
    const job = (s.jobs as Row | null) ?? {};
    if (job.status === "cancelled" || job.status === "completed") continue;
    const crew = (job.job_crew as Row[] | null) ?? [];
    for (const m of crew) {
      const prof = (m.profiles as { full_name?: string | null; email?: string } | null) ?? {};
      crewToday.set(String(m.profile_id), {
        name: prof.full_name || prof.email || "Crew member",
        why: `On ${String(job.name ?? "a job").split(/\s+[—-]\s+|,/)[0]} today`,
        next: "Owner is texted at 8:30 AM if they haven't checked in",
      });
    }
  }

  const clientAuto = (a: Omit<Automation, "on" | "offNote">, ruleOn = true): Automation => ({
    ...a,
    on: clientOn && ruleOn,
    offNote: !clientOn ? offNote : !ruleOn ? "This message is switched off, so nobody is being sent it. The list is who would be." : undefined,
  });

  return {
    sales: [
      clientAuto({ id: "eval-emails", name: "Evaluation emails", to: "Clients", channel: "Email", how: "Confirmation when booked, two days before, the day before, the morning of, and a thank-you after.", people: evalEmails }),
      clientAuto({ id: "eval-texts", name: "Evaluation reminder text", to: "Clients", channel: "Text", how: "A text the evening before the visit.", people: evalTexts }, evalRule.enabled),
      clientAuto({ id: "proposal-followups", name: "Proposal follow-ups", to: "Clients", channel: "Email", how: "Emails 3 and 7 days after a proposal goes out, until it's accepted, declined or expires.", people: followUps }, propRule.enabled),
      {
        id: "evaluator-reminders", name: "Evaluator appointment reminders", to: "Team", channel: "Text or email",
        how: `The evaluator is reminded ${lead} hours before each visit.`, on: calOn,
        offNote: calOn ? undefined : "Switched off on the company calendar, so nobody is being sent these. The list is who would be.",
        people: evaluatorReminders,
      },
      { id: "open-time", name: "Morning open-time email", to: "Team", channel: "Email", how: "Each seller's open slots for the day, every morning except Sunday.", on: true, people: openTime },
    ],
    operations: [
      clientAuto({ id: "job-start", name: "Job start reminder", to: "Clients", channel: "Text", how: "A text the morning the crew is due, for every job with a start date.", people: starts }, startRule.enabled),
      { id: "crew-checkin", name: "Crew check-in alert", to: "Owner", channel: "Text or email", how: "If somebody on today's crew hasn't checked in by 8:30, the owner is told.", on: true, people: [...crewToday.values()] },
    ],
  };
}

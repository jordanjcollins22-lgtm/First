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
import { lastClientContact, loadSequenceSettings } from "@/lib/data/client-automations";
import { previewRenewals, previewSaltPresell, type CampaignPreview } from "@/lib/data/client-campaigns";
import { isLiveFor, SEQUENCE_LABEL, SEQUENCE_WHY, type SequenceKey } from "@/lib/client-automations/settings";
import { followUpPlan, followUpStop, LEGACY_OFFSETS_HOURS } from "@/lib/client-automations/proposal-follow-ups";
import { invoiceDueAt } from "@/lib/client-automations/invoices";
import { reviewStepDue } from "@/lib/client-automations/reviews";
import { classifyMissedVisit } from "@/lib/client-automations/no-show";

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

/**
 * What the A2 sequences are working on, read the way their senders read it
 * (cron/client-reminders for invoices, cron/client-automations for the rest),
 * each from the moment its switch went on.
 */
async function loadA2(sb: SupabaseClient, organizationId: string, now: Date) {
  const settings = await loadSequenceSettings(sb, organizationId);
  const iso = (d: Date | null) => (d ?? now).toISOString();
  const custSelect = "property:properties!inner(customer:customers!inner(id,name,email,phone,do_not_contact,organization_id))";
  const empty = { data: [] as Row[] };
  const s = settings;
  const [invoices, reviews, missed, declined, calls, renewals, salt] = await Promise.all([
    s.invoice_reminders.enabled
      ? sb.from("invoices").select(`id,job_id,amount,sent_at,created_at,pay_by,job:jobs!inner(name,${custSelect})`).eq("organization_id", organizationId).eq("status", "open").gte("created_at", iso(s.invoice_reminders.startedAt)).limit(300)
      : empty,
    s.review_requests.enabled
      ? sb.from("review_requests").select("id,trigger,triggered_at,customer:customers(id,name,email,phone,do_not_contact)").eq("organization_id", organizationId).is("rated_at", null).gte("triggered_at", new Date(now.getTime() - (s.review_requests.config.reviewReminderDays + 2) * 24 * HOUR).toISOString()).limit(300)
      : empty,
    sb.from("jobs")
      .select(`id,name,evaluation_date,cancellation_reason,updated_at,${custSelect}`)
      .eq("property.customer.organization_id", organizationId)
      .eq("evaluation_status", "cancelled")
      .gte("evaluation_date", new Date(now.getTime() - 10 * 24 * HOUR).toISOString())
      .gte("updated_at", iso(s.no_show_rebook.startedAt))
      .limit(300),
    sb.from("job_proposals")
      .select("id,job_id,responded_at,updated_at,job:jobs!inner(name,property:properties!inner(customer:customers!inner(id,name,email,phone,do_not_contact)))")
      .eq("organization_id", organizationId)
      .eq("status", "declined")
      .is("office_declined_by", null)
      .gte("updated_at", iso(s.win_back.startedAt))
      .limit(300),
    s.missed_call_text.enabled
      ? sb.from("voice_calls").select("id,from_number,created_at,customer:customers(id,name)").eq("organization_id", organizationId).eq("direction", "inbound").eq("missed", true).gte("created_at", new Date(now.getTime() - 24 * HOUR).toISOString()).limit(100)
      : empty,
    previewRenewals(organizationId, now).catch(() => null),
    previewSaltPresell(organizationId, now).catch(() => null),
  ]);
  const rows = (r: { data: unknown }) => ((r.data ?? []) as Row[]);
  const out = {
    settings,
    invoices: rows(invoices),
    reviews: rows(reviews),
    // Before the switch is ever on there is no start, and nothing is in it.
    missed: s.no_show_rebook.startedAt ? rows(missed) : [],
    declined: s.win_back.startedAt ? rows(declined) : [],
    calls: rows(calls),
    renewals,
    salt,
  };
  return {
    ...out,
    referenceIds: [
      ...out.invoices.map((r) => String(r.id)),
      ...out.reviews.map((r) => String(r.id)),
      ...out.missed.map((r) => String(r.id)),
      ...out.declined.map((r) => String(r.job_id)),
      ...out.calls.map((r) => String(r.id)),
    ],
  };
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
      .select("id,sent_at,expires_at,job:jobs!inner(id,name,cancelled_at,property:properties!inner(customer:customers!inner(id,name,email,phone,do_not_contact)))")
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
  const a2 = await loadA2(sb, organizationId, now);
  const sent = await logsFor(sb, [
    ...evalJobs.map((j) => String(j.id)),
    ...startJobs.map((j) => String(j.id)),
    ...proposals.map((p) => String(p.id)),
    ...a2.referenceIds,
  ]);

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
    evalEmails.push({ name: nameOf(c, j.name), why: `Evaluation ${visitTime(e)}`, next: `Next: ${STEP_LABEL[togo[0].step]} email, ${when(togo[0].at)}${togo.length > 1 ? ` (${togo.length - 1} more after)` : ""}`, ref: { kind: "sales.evaluation", id } });
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
    if (togo.length) evalTexts.push({ name: nameOf(c, j.name), why: `Evaluation ${visitTime(e)}`, next: `Text ${when(togo[0].at)}`, ref: { kind: "sales.evaluation", id: String(j.id) } });
  }

  // Proposal follow-ups: the five-touch plan for proposals sent since it was
  // switched on, the original two emails for the rest. Out of it the moment
  // the client says anything, as the sender is (cron/client-reminders).
  const propRule = rule("proposal_follow_up");
  const followSetting = a2.settings.proposal_follow_ups;
  const replied = await lastClientContact(sb, proposals.map((p) => String(customerOf((p.job as Row | null) ?? {}).id ?? "")));
  const followUps: AutomationPerson[] = [];
  for (const p of proposals) {
    const job = (p.job as Row | null) ?? {};
    const c = customerOf(job);
    const at = new Date(String(p.sent_at));
    const expires = p.expires_at ? new Date(String(p.expires_at)) : null;
    if (followUpStop({ status: "sent", sentAt: at, expiresAt: expires, lastClientContactAt: replied.get(String(c.id)) ?? null }, now)) continue;
    const plan = isLiveFor(followSetting, at)
      ? followUpPlan(followSetting.config.followUpDays)
      : LEGACY_OFFSETS_HOURS.flatMap((offsetHours) => propRule.channels.map((channel) => ({ offsetHours, channel })));
    const reachable = plan.filter((t) => (t.channel === "sms" ? canText(c) : canEmail(c)));
    const done = new Set(reachable.filter((t) => sent.has(`proposal_follow_up:${p.id}:${t.offsetHours}:${t.channel}`)).map((t) => t.offsetHours));
    const togo = offsetsToGo(at, [...new Set(reachable.map((t) => t.offsetHours))], now, done);
    if (!togo.length) continue;
    const touch = reachable.find((t) => t.offsetHours === togo[0].offset);
    followUps.push({
      name: nameOf(c, job.name),
      why: `Proposal sent ${visitTime(at)}, not answered`,
      next: `Follow-up ${touch?.channel === "sms" ? "text" : "email"} ${when(togo[0].at)}${togo.length > 1 ? ` (${togo.length - 1} more after)` : ""}`,
      ref: { kind: "sales.proposal", id: String(p.id) },
    });
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
    if (togo.length) starts.push({ name: nameOf(c, j.name), why: `Job starts ${day}`, next: `Text ${when(togo[0].at)}`, ref: { kind: "ops.job", id: String(j.id) } });
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
        ref: { kind: "sales.evaluation", id: String(j.id) },
      };
    });

  // Morning open-time email to everybody who sells.
  const openTime: AutomationPerson[] = (team as { id: string; name: string; email: string | null }[])
    .filter((t) => t.email)
    .map((t) => ({ name: t.name, why: "Sells or does evaluations", next: "Every morning, Monday to Saturday", ref: { kind: "sales.evaluator", id: t.id } }));

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
        ref: { kind: "ops.crew_member", id: String(m.profile_id) },
      });
    }
  }

  const clientAuto = (a: Omit<Automation, "on" | "offNote">, ruleOn = true): Automation => ({
    ...a,
    on: clientOn && ruleOn,
    offNote: !clientOn ? offNote : !ruleOn ? "This message is switched off, so nobody is being sent it. The list is who would be." : undefined,
  });

  // The A2 sequences (client-automations). Each is on only when its own
  // switch is, as well as the business's, and only reaches records since.
  const a2Auto = (key: SequenceKey, a: Omit<Automation, "on" | "offNote" | "name" | "to">): Automation => {
    const setting = a2.settings[key];
    return {
      ...a,
      name: SEQUENCE_LABEL[key],
      to: "Clients",
      on: clientOn && setting.enabled,
      offNote: !clientOn ? offNote : !setting.enabled ? "Switched off in Sales › Automated messages, so nobody is being sent this. The list is who would be." : undefined,
    };
  };

  // Invoice reminders: open invoices raised since the switch, next nudge to go.
  const invRule = rule("invoice_reminder");
  const invoicePeople: AutomationPerson[] = [];
  for (const inv of a2.invoices) {
    const c = customerOf((inv.job as Row | null) ?? {});
    if (inv.pay_by) continue;
    const dueAt = invoiceDueAt({ sentAt: (inv.sent_at as string | null) ?? null, createdAt: String(inv.created_at) });
    const reachable = invRule.channels.filter((ch) => (ch === "sms" ? canText(c) : canEmail(c)));
    if (!reachable.length) continue;
    const done = new Set(invRule.offsetsHours.filter((o) => reachable.every((ch) => sent.has(`invoice_reminder:${inv.id}:${o}:${ch}`))));
    const togo = offsetsToGo(dueAt, invRule.offsetsHours, now, done);
    const amount = `$${Number(inv.amount).toLocaleString("en-US")}`;
    invoicePeople.push({
      name: nameOf(c, (inv.job as Row | null)?.name),
      why: `${amount} due ${dueAt.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}`,
      next: togo.length ? `Reminder ${when(togo[0].at)}` : `Collections after ${a2.settings.invoice_reminders.config.collectionsAfterDays} days past due`,
      ...(inv.job_id ? { ref: { kind: "ops.job", id: String(inv.job_id) } } : {}),
    });
  }

  // Review requests waiting on a rating.
  const reviewPeople: AutomationPerson[] = a2.reviews.map((r) => {
    const triggered = new Date(String(r.triggered_at));
    const step = reviewStepDue({ triggeredAt: triggered, ratedAt: null, now, reminderDays: a2.settings.review_requests.config.reviewReminderDays });
    const askSent = sent.has(`review_request:${r.id}:ask:sms`) || sent.has(`review_request:${r.id}:ask:email`);
    const reminderAt = new Date(triggered.getTime() + a2.settings.review_requests.config.reviewReminderDays * 24 * HOUR);
    return {
      name: nameOf((r.customer as Customer | null) ?? {}, "Client"),
      why: `${r.trigger === "paid" ? "Paid the invoice" : "Approved the before and afters"} ${visitTime(triggered)}`,
      next: !askSent && step === "ask" ? "Rating link, going out on the next run" : reminderAt > now ? `Reminder ${when(reminderAt)}` : "Waiting on their rating",
      ...((r.customer as Customer | null)?.id ? { ref: { kind: "ops.client", id: String((r.customer as Customer).id) } } : {}),
    };
  });

  // No-show and client-cancel rebooks still to go.
  const rebookDays = a2.settings.no_show_rebook.config.rebookDays;
  const rebookPeople: AutomationPerson[] = [];
  for (const j of a2.missed) {
    const kind = classifyMissedVisit(j.cancellation_reason as string | null);
    if (!kind) continue;
    const c = customerOf(j);
    const anchor = new Date(String(j.updated_at));
    const done = new Set(rebookDays.filter((d) => sent.has(`no_show_rebook:${j.id}:${d}:sms`) || sent.has(`no_show_rebook:${j.id}:${d}:email`)));
    const togo = offsetsToGo(anchor, rebookDays.map((d) => d * 24), now, new Set([...done].map((d) => d * 24)));
    if (!togo.length) continue;
    rebookPeople.push({ name: nameOf(c, j.name), why: `${kind === "no_show" ? "No-show" : "Cancelled"} ${visitTime(new Date(String(j.evaluation_date)))}`, next: `Rebook link ${when(togo[0].at)}`, ref: { kind: "sales.evaluation", id: String(j.id) } });
  }

  // Win-back of declines since the switch.
  const winDays = a2.settings.win_back.config.winBackDays;
  const winPeople: AutomationPerson[] = [];
  for (const p of a2.declined) {
    const job = (p.job as Row | null) ?? {};
    const c = customerOf(job);
    const declinedAt = new Date(String(p.responded_at ?? p.updated_at));
    const done = new Set(winDays.filter((d) => sent.has(`win_back:${p.job_id}:${d}:sms`) || sent.has(`win_back:${p.job_id}:${d}:email`)).map((d) => d * 24));
    const togo = offsetsToGo(declinedAt, winDays.map((d) => d * 24), now, done);
    if (!togo.length) continue;
    winPeople.push({ name: nameOf(c, job.name), why: `Declined ${visitTime(declinedAt)}`, next: `Win-back ${when(togo[0].at)} (if they said yes to marketing)`, ref: { kind: "sales.proposal", id: String(p.id) } });
  }

  // Missed callers in the last day, and whether they were texted.
  const missedPeople: AutomationPerson[] = a2.calls.map((call) => ({
    ...((call.customer as Customer | null)?.id ? { ref: { kind: "sales.client", id: String((call.customer as Customer).id) } } : {}),
    name: nameOf((call.customer as Customer | null) ?? {}, call.from_number),
    why: `Missed call ${visitTime(new Date(String(call.created_at)))}`,
    next: [...sent].some((k) => k.startsWith(`missed_call_text:${String(call.from_number ?? "").replace(/\D/g, "").slice(-10)}:`)) ? "Texted back" : "Text going out when sending hours open",
  }));

  const campaignAuto = (id: string, name: string, how: string, preview: CampaignPreview | null): Automation => ({
    id,
    name,
    to: "Clients",
    channel: "Text or email",
    how,
    on: false,
    offNote: "You start this one: nobody gets it until you press Start in Sales › Automated messages. The list is who would.",
    people: (preview?.rows ?? []).filter((r) => !r.skip).map((r) => ({
      name: r.name,
      why: r.detail,
      next: r.channels.map((ch) => (ch === "sms" ? "Text" : "Email")).join(" + "),
      ref: { kind: "sales.client", id: r.customerId },
    })),
  });

  const a2Sales: Automation[] = [
    a2Auto("no_show_rebook", { id: "no-show-rebook", channel: "Text or email", how: `A rebook link the day a visit is missed or the client cancels, and on day ${rebookDays.filter((d) => d > 0).join(", ") || "3"}. Stops when they book or reply.`, people: rebookPeople }),
    a2Auto("win_back", { id: "win-back", channel: "Text or email", how: `Days ${winDays.join(", ")} after a decline, offering a Phase 1 priced from the areas. Marketing: only to clients who said yes.`, people: winPeople }),
    a2Auto("missed_call_text", { id: "missed-call-text", channel: "Text", how: "A caller nobody answered is texted within a minute: book here or reply. Once per number per day.", people: missedPeople }),
    campaignAuto("renewals", SEQUENCE_LABEL.renewals, SEQUENCE_WHY.renewals, a2.renewals),
    campaignAuto("salt-presell", SEQUENCE_LABEL.salt_presell, SEQUENCE_WHY.salt_presell, a2.salt),
  ];
  const a2Operations: Automation[] = [
    a2Auto("invoice_reminders", { id: "invoice-reminders", channel: "Text or email", how: "3 days before the due date, on it, 7 and 21 days late, each with the pay link. Then collections comes to you. Stops when paid or voided.", people: invoicePeople }),
    a2Auto("review_requests", { id: "review-requests", channel: "Text or email", how: "After a /done approval or the invoice is paid: a 1–5 rating link, fives on to Google, one reminder. Not twice in 12 months.", people: reviewPeople }),
  ];

  return {
    sales: [
      clientAuto({ id: "eval-emails", name: "Evaluation emails", to: "Clients", channel: "Email", how: "Confirmation when booked, two days before, the day before, the morning of, and a thank-you after.", people: evalEmails }),
      clientAuto({ id: "eval-texts", name: "Evaluation reminder text", to: "Clients", channel: "Text", how: "A text the evening before the visit.", people: evalTexts }, evalRule.enabled),
      clientAuto(
        {
          id: "proposal-followups",
          name: "Proposal follow-ups",
          to: "Clients",
          channel: followSetting.enabled ? "Text or email" : "Email",
          how: followSetting.enabled
            ? `Days ${followSetting.config.followUpDays.join(", ")} after a proposal goes out, email and text in turn. Stops when they reply on any channel, accept, decline or it expires.`
            : "Emails 3 and 7 days after a proposal goes out. Stops when they reply on any channel, accept, decline or it expires.",
          people: followUps,
        },
        propRule.enabled
      ),
      ...a2Sales,
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
      ...a2Operations,
      { id: "crew-checkin", name: "Crew check-in alert", to: "Owner", channel: "Text or email", how: "If somebody on today's crew hasn't checked in by 8:30, the owner is told.", on: true, people: [...crewToday.values()] },
    ],
  };
}

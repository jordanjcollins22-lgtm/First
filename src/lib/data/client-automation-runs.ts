import { randomBytes } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { isResendConfigured, isSmsConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { fitSms } from "@/lib/client-message-templates";
import { contactsFor, sendClientMessage, type ClientContact, type SendOutcome } from "@/lib/data/client-messaging";
import { lastClientContact, openAutomationException, untyped } from "@/lib/data/client-automations";
import type { QuietWindow } from "@/lib/quiet-hours";
import type { SendBasis, Channel } from "@/lib/client-consent";
import { isLiveFor, type SequenceKey, type SequenceSetting } from "@/lib/client-automations/settings";
import { textElseEmail } from "@/lib/client-automations/channels";
import { collectionsKey, invoiceDueAt, needsCollections } from "@/lib/client-automations/invoices";
import { FIRST_ASK_WINDOW_HOURS, reviewDedupeKey, reviewMessage, reviewSkipReason, reviewStepDue } from "@/lib/client-automations/reviews";
import { classifyMissedVisit, rebookDedupeKey, rebookMessage, rebookStepsDue } from "@/lib/client-automations/no-show";
import { autoPhaseOne, winBackDedupeKey, winBackMessage } from "@/lib/win-back";
import { missedCallKey, missedCallText } from "@/lib/client-automations/calls";
import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * The timed A2 sequences, run for one business by cron/client-automations:
 * review requests, no-show rebooking, win-back, collections hand-offs and
 * missed-call texts held overnight. Invoice reminders and proposal
 * follow-ups ride the existing client-reminders run instead, beside the
 * reminders they replace.
 *
 * Every send goes through sendClientMessage under a stable key, so this is
 * safe to run twice, late, or twice at once. Every sequence checks its own
 * switch and acts only on records since it went on (isLiveFor).
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Admin = ReturnType<typeof createAdminClient>;

export interface RunContext {
  admin: Admin;
  org: { id: string; name: string };
  window: QuietWindow;
  origin: string;
  now: Date;
  settings: Record<SequenceKey, SequenceSetting>;
}

export type Tally = Record<string, number>;

const ready = () => ({ sms: isSmsConfigured, email: isResendConfigured });

function count(tally: Tally, key: string, outcome: SendOutcome | null) {
  const k = !outcome ? `${key}.none` : outcome.sent ? `${key}.sent` : `${key}.${outcome.reason}`;
  tally[k] = (tally[k] ?? 0) + 1;
}

async function deliver(
  ctx: RunContext,
  contact: ClientContact,
  input: { channel: Channel; basis: SendBasis; kind: string; referenceId: string | null; dedupeKey: string; subject: string; body: string }
): Promise<SendOutcome> {
  return sendClientMessage(
    {
      organizationId: ctx.org.id,
      customerId: contact.id,
      channel: input.channel,
      basis: input.basis,
      kind: input.kind,
      referenceId: input.referenceId,
      dedupeKey: input.dedupeKey,
      subject: input.subject,
      body: input.channel === "sms" ? fitSms(input.body) : input.body,
      automatic: true,
    },
    contact,
    ctx.window,
    ctx.now
  );
}

/** The keys among these already used, for this business. */
async function usedKeys(ctx: RunContext, keys: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 200) {
    const { data } = await ctx.admin
      .from("client_message_log")
      .select("dedupe_key")
      .eq("organization_id", ctx.org.id)
      .in("dedupe_key", keys.slice(i, i + 200));
    for (const row of data ?? []) out.add(row.dedupe_key);
  }
  return out;
}

const optOut = (contact: ClientContact, channel: Channel) => channel === "sms" && !contact.textedBefore;
const unsubscribe = (ctx: RunContext, contact: ClientContact) => (contact.unsubscribeToken ? `${ctx.origin}/u/${contact.unsubscribeToken}` : null);

/* -------------------------------------------------------------------------
 * Invoice collections: the hand-off after the last reminder
 * ---------------------------------------------------------------------- */

export async function runCollections(ctx: RunContext, tally: Tally): Promise<void> {
  const setting = ctx.settings.invoice_reminders;
  if (!setting.enabled || !setting.startedAt) return;
  const { data } = await ctx.admin
    .from("invoices")
    .select("id, status, amount, sent_at, created_at, paid_at, hosted_invoice_url, pay_by, job_id, job:jobs!inner(name, property:properties!inner(customer_id, customer:customers(name)))")
    .eq("organization_id", ctx.org.id)
    .eq("status", "open")
    .gte("created_at", setting.startedAt.toISOString())
    .limit(500);
  type Row = {
    id: string; status: string; amount: number; sent_at: string | null; created_at: string; paid_at: string | null;
    hosted_invoice_url: string | null; pay_by: string | null; job_id: string;
    job: { name: string | null; property: { customer_id: string | null; customer: { name: string | null } | null } | null } | null;
  };
  for (const row of (data ?? []) as unknown as Row[]) {
    const facts = { id: row.id, status: row.status, amount: Number(row.amount), sentAt: row.sent_at, createdAt: row.created_at, paidAt: row.paid_at, hostedInvoiceUrl: row.hosted_invoice_url, payBy: row.pay_by };
    if (!isLiveFor(setting, row.created_at)) continue;
    if (!needsCollections(facts, ctx.now, setting.config.collectionsAfterDays)) continue;
    const late = Math.floor((ctx.now.getTime() - invoiceDueAt(facts).getTime()) / DAY);
    const who = row.job?.property?.customer?.name?.trim() || "A client";
    const opened = await openAutomationException({
      organizationId: ctx.org.id,
      kind: "collections",
      summary: `${who} owes $${Number(row.amount).toLocaleString("en-US")}, ${late} days past due after every reminder.`,
      detail: [
        row.job?.name ? `Job: ${row.job.name}.` : null,
        row.pay_by ? `They said they'd pay by ${row.pay_by}; nobody has recorded it.` : "Four reminders went with the pay link; it is still open in Stripe.",
        "Call them, or mark the invoice paid, void or uncollectible in Stripe and this closes by itself.",
      ].filter(Boolean).join(" "),
      customerId: row.job?.property?.customer_id ?? null,
      jobId: row.job_id,
      referenceId: row.id,
      dedupeKey: collectionsKey(row.id),
    });
    if (opened) tally["collections.opened"] = (tally["collections.opened"] ?? 0) + 1;
  }

  // An invoice paid or voided since closes its collections item by itself.
  const sb = untyped(ctx.admin);
  const { data: open } = await sb
    .from("client_automation_exceptions")
    .select("id, reference_id")
    .eq("organization_id", ctx.org.id)
    .eq("kind", "collections")
    .eq("state", "open");
  const ids = ((open ?? []) as { id: string; reference_id: string | null }[]).filter((r) => r.reference_id);
  if (ids.length > 0) {
    const { data: settled } = await ctx.admin.from("invoices").select("id").in("id", ids.map((r) => r.reference_id!)).neq("status", "open");
    const done = new Set((settled ?? []).map((r) => r.id));
    const close = ids.filter((r) => done.has(r.reference_id!)).map((r) => r.id);
    if (close.length > 0) {
      await sb.from("client_automation_exceptions").update({ state: "resolved", resolved_at: ctx.now.toISOString() }).in("id", close);
    }
  }
}

/* -------------------------------------------------------------------------
 * Review requests
 * ---------------------------------------------------------------------- */

export async function runReviewRequests(ctx: RunContext, tally: Tally): Promise<void> {
  const setting = ctx.settings.review_requests;
  if (!setting.enabled || !setting.startedAt || !setting.config.googleReviewLink) return;
  const sb = untyped(ctx.admin);
  // Only triggers still inside the first-ask window: an older one would open
  // with the day-3 "reminder" and never the ask itself.
  const since = new Date(Math.max(setting.startedAt.getTime(), ctx.now.getTime() - FIRST_ASK_WINDOW_HOURS * HOUR)).toISOString();

  // What sets one off: a /done approval, or an invoice paid.
  const [signoffs, paid] = await Promise.all([
    ctx.admin
      .from("job_client_reviews")
      .select("job_id, responded_at, job:jobs!inner(property:properties!inner(customer_id))")
      .eq("organization_id", ctx.org.id)
      .eq("status", "approved")
      .gte("responded_at", since)
      .limit(300),
    ctx.admin
      .from("invoices")
      .select("job_id, paid_at, job:jobs!inner(property:properties!inner(customer_id))")
      .eq("organization_id", ctx.org.id)
      .eq("status", "paid")
      .gte("paid_at", since)
      .limit(300),
  ]);
  type Trig = { job_id: string; at: string | null; job: { property: { customer_id: string | null } | null } | null };
  const triggers = [
    ...((signoffs.data ?? []) as unknown as (Trig & { responded_at: string })[]).map((t) => ({ jobId: t.job_id, at: t.responded_at, customerId: t.job?.property?.customer_id ?? null, trigger: "signoff" as const })),
    ...((paid.data ?? []) as unknown as (Trig & { paid_at: string })[]).map((t) => ({ jobId: t.job_id, at: t.paid_at, customerId: t.job?.property?.customer_id ?? null, trigger: "paid" as const })),
  ]
    .filter((t) => t.customerId && t.at && isLiveFor(setting, t.at))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));

  const customerIds = [...new Set(triggers.map((t) => t.customerId!))];
  if (customerIds.length > 0) {
    const [existing, reviewed] = await Promise.all([
      sb.from("review_requests").select("job_id, customer_id, created_at, sent_to_google_at").eq("organization_id", ctx.org.id).in("customer_id", customerIds),
      ctx.admin.from("jobs").select("property:properties!inner(customer_id)").eq("five_star_review", true).in("property.customer_id", customerIds),
    ]);
    const rows = (existing.data ?? []) as { job_id: string; customer_id: string; created_at: string; sent_to_google_at: string | null }[];
    const hasJob = new Set(rows.map((r) => r.job_id));
    const reviewedCustomers = new Set(((reviewed.data ?? []) as unknown as { property: { customer_id: string } | null }[]).map((r) => r.property?.customer_id));

    for (const t of triggers) {
      if (hasJob.has(t.jobId)) continue;
      const history = {
        hasRecordedReview: reviewedCustomers.has(t.customerId!),
        earlier: rows.filter((r) => r.customer_id === t.customerId).map((r) => ({ createdAt: new Date(r.created_at), sentToGoogleAt: r.sent_to_google_at ? new Date(r.sent_to_google_at) : null })),
      };
      const skip = reviewSkipReason(history, ctx.now, setting.config.reviewCooldownMonths);
      if (skip) {
        tally[`review.${skip}`] = (tally[`review.${skip}`] ?? 0) + 1;
        continue;
      }
      const { error } = await sb.from("review_requests").insert({
        organization_id: ctx.org.id,
        customer_id: t.customerId,
        job_id: t.jobId,
        trigger: t.trigger,
        triggered_at: t.at,
        token: randomBytes(12).toString("base64url"),
      });
      if (!error) {
        hasJob.add(t.jobId);
        rows.push({ job_id: t.jobId, customer_id: t.customerId!, created_at: ctx.now.toISOString(), sent_to_google_at: null });
      }
    }
  }

  // Everything still waiting on a rating, inside its ask or reminder window.
  const horizon = new Date(ctx.now.getTime() - (setting.config.reviewReminderDays + 2) * DAY).toISOString();
  const { data: pending } = await sb
    .from("review_requests")
    .select("id, customer_id, token, triggered_at, rated_at")
    .eq("organization_id", ctx.org.id)
    .is("rated_at", null)
    .gte("triggered_at", horizon)
    .limit(300);
  const requests = (pending ?? []) as { id: string; customer_id: string; token: string; triggered_at: string; rated_at: string | null }[];
  if (requests.length === 0) return;
  const contacts = await contactsFor(requests.map((r) => r.customer_id));
  const steps = requests
    .map((r) => ({ r, step: reviewStepDue({ triggeredAt: new Date(r.triggered_at), ratedAt: null, now: ctx.now, reminderDays: setting.config.reviewReminderDays }) }))
    .filter((x): x is { r: (typeof requests)[number]; step: "ask" | "reminder" } => x.step != null);
  const used = await usedKeys(ctx, steps.flatMap(({ r, step }) => [reviewDedupeKey(r.id, step, "sms"), reviewDedupeKey(r.id, step, "email")]));

  for (const { r, step } of steps) {
    const contact = contacts.get(r.customer_id);
    if (!contact) continue;
    if (used.has(reviewDedupeKey(r.id, step, "sms")) || used.has(reviewDedupeKey(r.id, step, "email"))) continue;
    const channel = textElseEmail(contact, "service", ready());
    if (!channel) {
      count(tally, "review", null);
      continue;
    }
    const msg = reviewMessage({
      step,
      channel,
      businessName: ctx.org.name,
      clientName: contact.name,
      link: `${ctx.origin}/rate/${r.token}`,
      includeOptOut: optOut(contact, channel),
      unsubscribeUrl: unsubscribe(ctx, contact),
    });
    // About work just finished, with no offer in it: service, not marketing.
    count(tally, "review", await deliver(ctx, contact, { channel, basis: "service", kind: "review_request", referenceId: r.id, dedupeKey: reviewDedupeKey(r.id, step, channel), ...msg }));
  }
}

/* -------------------------------------------------------------------------
 * No-show and client-cancel rebooking
 * ---------------------------------------------------------------------- */

export async function runNoShowRebook(ctx: RunContext, tally: Tally): Promise<void> {
  const setting = ctx.settings.no_show_rebook;
  if (!setting.enabled || !setting.startedAt) return;
  const { data } = await ctx.admin
    .from("jobs")
    .select("id, evaluation_date, cancellation_reason, updated_at, property:properties!inner(customer_id, customer:customers!inner(organization_id))")
    .eq("property.customer.organization_id", ctx.org.id)
    .eq("evaluation_status", "cancelled")
    .gte("evaluation_date", new Date(ctx.now.getTime() - 10 * DAY).toISOString())
    .gte("updated_at", setting.startedAt.toISOString())
    .limit(300);
  type Row = { id: string; evaluation_date: string; cancellation_reason: string | null; updated_at: string; property: { customer_id: string | null } | null };
  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => ({ ...r, kind: classifyMissedVisit(r.cancellation_reason), customerId: r.property?.customer_id ?? null }))
    .filter((r) => r.kind && r.customerId && isLiveFor(setting, r.updated_at));
  if (rows.length === 0) return;

  const customerIds = [...new Set(rows.map((r) => r.customerId!))];
  // Booked again since: any other visit of theirs that isn't cancelled and
  // was made, or falls, after this one was called off.
  const { data: others } = await ctx.admin
    .from("jobs")
    .select("id, evaluation_date, evaluation_status, created_at, property:properties!inner(customer_id)")
    .in("property.customer_id", customerIds)
    .neq("evaluation_status", "cancelled")
    .not("evaluation_date", "is", null)
    .limit(1000);
  const otherVisits = (others ?? []) as unknown as { id: string; evaluation_date: string; created_at: string; property: { customer_id: string } | null }[];
  const replied = await lastClientContact(ctx.admin, customerIds);
  const contacts = await contactsFor(customerIds);
  const days = setting.config.rebookDays;

  const plan: { row: (typeof rows)[number]; day: number; contact: ClientContact; channel: Channel }[] = [];
  for (const row of rows) {
    const anchor = new Date(row.updated_at);
    const rebooked = otherVisits.some(
      (o) => o.property?.customer_id === row.customerId && o.id !== row.id && (new Date(o.created_at) >= anchor || new Date(o.evaluation_date) >= ctx.now)
    );
    if (rebooked) continue;
    const said = replied.get(row.customerId!);
    if (said && said > anchor) continue;
    const contact = contacts.get(row.customerId!);
    if (!contact) continue;
    const channel = textElseEmail(contact, "service", ready());
    if (!channel) continue;
    for (const day of rebookStepsDue({ anchor, days, now: ctx.now })) plan.push({ row, day, contact, channel });
  }
  const used = await usedKeys(ctx, plan.flatMap((p) => [rebookDedupeKey(p.row.id, p.day, "sms"), rebookDedupeKey(p.row.id, p.day, "email")]));
  for (const p of plan) {
    if (used.has(rebookDedupeKey(p.row.id, p.day, "sms")) || used.has(rebookDedupeKey(p.row.id, p.day, "email"))) continue;
    const msg = rebookMessage({
      kind: p.row.kind!,
      day: p.day,
      channel: p.channel,
      businessName: ctx.org.name,
      clientName: p.contact.name,
      link: `${ctx.origin}/book`,
      includeOptOut: optOut(p.contact, p.channel),
      unsubscribeUrl: unsubscribe(ctx, p.contact),
    });
    // They asked for this visit: rebooking it is service.
    count(tally, "rebook", await deliver(ctx, p.contact, { channel: p.channel, basis: "service", kind: "no_show_rebook", referenceId: p.row.id, dedupeKey: rebookDedupeKey(p.row.id, p.day, p.channel), ...msg }));
  }
}

/* -------------------------------------------------------------------------
 * Win-back of declined proposals at 30, 90 and 180 days
 * ---------------------------------------------------------------------- */

export async function runWinBack(ctx: RunContext, tally: Tally): Promise<void> {
  const setting = ctx.settings.win_back;
  if (!setting.enabled || !setting.startedAt) return;
  const days = setting.config.winBackDays;
  const longest = Math.max(...days, 0) + 2;
  const { data } = await ctx.admin
    .from("job_proposals")
    .select("id, job_id, total_cost, discount_amount, responded_at, updated_at, office_declined_by, scope_snapshot, job:jobs!inner(status, cancelled_at, property:properties!inner(customer_id))")
    .eq("organization_id", ctx.org.id)
    .eq("status", "declined")
    .is("office_declined_by", null)
    .gte("updated_at", new Date(ctx.now.getTime() - longest * DAY).toISOString())
    .limit(500);
  type Row = {
    id: string; job_id: string; total_cost: number | null; discount_amount: number | null; responded_at: string | null; updated_at: string;
    office_declined_by: string | null; scope_snapshot: ProposalZoneSnapshot[] | null;
    job: { status: string; cancelled_at: string | null; property: { customer_id: string | null } | null } | null;
  };
  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => ({ ...r, declinedAt: new Date(r.responded_at ?? r.updated_at), customerId: r.job?.property?.customer_id ?? null }))
    // The decline itself must be since the switch: never the backlog.
    .filter((r) => r.customerId && r.job?.status !== "cancelled" && !r.job?.cancelled_at && isLiveFor(setting, r.declinedAt));
  if (rows.length === 0) return;

  const customerIds = [...new Set(rows.map((r) => r.customerId!))];
  const [calls, newer] = await Promise.all([
    ctx.admin.from("proposal_calls").select("proposal_id, outcome, created_at").in("proposal_id", rows.map((r) => r.id)).order("created_at", { ascending: false }),
    ctx.admin
      .from("job_proposals")
      .select("created_at, status, job:jobs!inner(property:properties!inner(customer_id))")
      .eq("organization_id", ctx.org.id)
      .in("status", ["needs_approval", "sent", "accepted"])
      .in("job.property.customer_id", customerIds),
  ]);
  const lastCall = new Map<string, string>();
  for (const c of calls.data ?? []) if (!lastCall.has(c.proposal_id)) lastCall.set(c.proposal_id, c.outcome);
  const live = (newer.data ?? []) as unknown as { created_at: string; job: { property: { customer_id: string } | null } | null }[];
  const replied = await lastClientContact(ctx.admin, customerIds);
  const contacts = await contactsFor(customerIds);

  const plan: { row: (typeof rows)[number]; day: number; contact: ClientContact; channel: Channel }[] = [];
  for (const row of rows) {
    const outcome = lastCall.get(row.id);
    if (outcome === "went_elsewhere" || outcome === "do_not_call") continue;
    // Something newer on the go for them (a Phase 1, another job): leave it to that.
    if (live.some((p) => p.job?.property?.customer_id === row.customerId && new Date(p.created_at) > row.declinedAt)) continue;
    // Talking to us since the decline: a person is on it.
    const said = replied.get(row.customerId!);
    if (said && said > row.declinedAt) continue;
    const contact = contacts.get(row.customerId!);
    if (!contact) continue;
    // Asking again after a no is marketing, which needs a yes on file.
    const channel = textElseEmail(contact, "marketing", ready());
    if (!channel) {
      tally["winback.no_consent"] = (tally["winback.no_consent"] ?? 0) + 1;
      continue;
    }
    for (const day of rebookStepsDue({ anchor: row.declinedAt, days, now: ctx.now })) plan.push({ row, day, contact, channel });
  }
  const used = await usedKeys(ctx, plan.flatMap((p) => [winBackDedupeKey(p.row.job_id, p.day, "sms"), winBackDedupeKey(p.row.job_id, p.day, "email")]));
  for (const p of plan) {
    if (used.has(winBackDedupeKey(p.row.job_id, p.day, "sms")) || used.has(winBackDedupeKey(p.row.job_id, p.day, "email"))) continue;
    const snapshot = p.row.scope_snapshot ?? [];
    const phase = autoPhaseOne({ snapshot, total: Number(p.row.total_cost ?? 0), discount: Number(p.row.discount_amount ?? 0) });
    const msg = winBackMessage({
      day: p.day,
      channel: p.channel,
      businessName: ctx.org.name,
      clientName: p.contact.name,
      phaseOne: phase ? { areas: phase.keep, price: phase.price } : null,
      includeOptOut: optOut(p.contact, p.channel),
      unsubscribeUrl: unsubscribe(ctx, p.contact),
    });
    count(tally, "winback", await deliver(ctx, p.contact, { channel: p.channel, basis: "marketing", kind: "win_back", referenceId: p.row.job_id, dedupeKey: winBackDedupeKey(p.row.job_id, p.day, p.channel), ...msg }));
  }
}

/* -------------------------------------------------------------------------
 * Missed-call texts held by quiet hours
 * ---------------------------------------------------------------------- */

/**
 * The webhook texts a missed caller straight away. One that rang at 11pm was
 * held by quiet hours; this sends it once the window opens, the same morning,
 * under the same once-a-day key.
 */
export async function runHeldMissedCalls(ctx: RunContext, tally: Tally): Promise<void> {
  const setting = ctx.settings.missed_call_text;
  if (!setting.enabled || !setting.startedAt) return;
  const sb = untyped(ctx.admin);
  const { data } = await sb
    .from("voice_calls")
    .select("id, from_number, customer_id, created_at")
    .eq("organization_id", ctx.org.id)
    .eq("direction", "inbound")
    .eq("missed", true)
    .not("customer_id", "is", null)
    .gte("created_at", new Date(Math.max(setting.startedAt.getTime(), ctx.now.getTime() - 14 * HOUR)).toISOString())
    .limit(200);
  const calls = (data ?? []) as { id: string; from_number: string | null; customer_id: string; created_at: string }[];
  if (calls.length === 0) return;
  const keyOf = (c: (typeof calls)[number]) => missedCallKey(c.from_number ?? "", dayIn(new Date(c.created_at), ctx.window.timeZone));
  const used = await usedKeys(ctx, calls.map(keyOf));
  const contacts = await contactsFor(calls.map((c) => c.customer_id));
  const seen = new Set<string>();
  for (const call of calls) {
    const key = keyOf(call);
    if (used.has(key) || seen.has(key)) continue;
    seen.add(key);
    const contact = contacts.get(call.customer_id);
    if (!contact) continue;
    count(tally, "missed_call", await sendMissedCallText(ctx, contact, call.id, key));
  }
}

export function dayIn(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The text-back itself, shared by the webhook and the morning catch-up. */
export async function sendMissedCallText(ctx: Pick<RunContext, "org" | "window" | "origin" | "now">, contact: ClientContact, callId: string, dedupeKey: string): Promise<SendOutcome> {
  const body = missedCallText({ businessName: ctx.org.name, bookLink: `${ctx.origin}/book`, includeOptOut: !contact.textedBefore });
  // They rang us a minute ago: answering is service.
  return sendClientMessage(
    { organizationId: ctx.org.id, customerId: contact.id, channel: "sms", basis: "service", kind: "missed_call_text", referenceId: callId, dedupeKey, subject: "", body: fitSms(body), automatic: true },
    contact,
    ctx.window,
    ctx.now
  );
}

/** Logged quietly when something in a run fails, so one bad row never stops the rest. */
export async function guarded(name: string, organizationId: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    log.error(`cron.client_automations.${name}`, error, { organizationId });
  }
}

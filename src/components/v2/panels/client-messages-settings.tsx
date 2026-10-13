import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadSequenceSettings, untyped } from "@/lib/data/client-automations";
import { previewRenewals, previewSaltPresell, type CampaignPreview } from "@/lib/data/client-campaigns";
import { quietWindowFor } from "@/lib/data/client-messaging";
import { isQuiet } from "@/lib/quiet-hours";
import { isResendConfigured, isSmsConfigured, isStripeConfigured, isTwilioConfigured } from "@/lib/env";
import { SEQUENCE_LABEL, SEQUENCE_WHY, type SequenceKey } from "@/lib/client-automations/settings";
import { invoiceDueAt } from "@/lib/client-automations/invoices";
import {
  CallDisposition,
  CampaignCard,
  ExceptionButtons,
  ReviewLinkField,
  SequenceSwitch,
  TimingField,
} from "@/components/v2/panels/client-messages-settings-controls";
import { OpenEntityButton } from "@/components/v2/panels/sales/open-entity-button";

/**
 * Sales › Automated messages: the client sequences that run without anybody,
 * and the few things they hand back.
 *
 * Top to bottom the way the owner should read it: what needs you (unpaid
 * invoices past the last reminder, unhappy ratings, answered calls waiting
 * for one tap), how the sequences are doing against target, then every
 * switch, timing and campaign button. Every sequence ships off and dates
 * itself when switched on, so nothing here ever texts the backlog.
 */

const DAY = 86_400_000;

type ExceptionRow = { id: string; kind: string; summary: string; detail: string | null; created_at: string; customer_id: string | null; job_id: string | null };
type CallRow = { id: string; created_at: string; direction: string; duration_seconds: number; customer: { id: string; name: string | null } | null };

export async function ClientMessagesSettingsPanel() {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const sb = untyped(supabase);
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * DAY).toISOString();

  const [org, settings, exceptions, calls, invoices, log30, ratings, proposals60] = await Promise.all([
    supabase.from("organizations").select("client_reminders_enabled, reminder_time_zone, reminder_quiet_start, reminder_quiet_end").eq("id", organizationId).maybeSingle(),
    loadSequenceSettings(supabase, organizationId),
    sb.from("client_automation_exceptions").select("id, kind, summary, detail, created_at, customer_id, job_id").eq("organization_id", organizationId).eq("state", "open").order("created_at", { ascending: false }).limit(30),
    sb
      .from("voice_calls")
      .select("id, created_at, direction, duration_seconds, customer:customers(id, name)")
      .eq("organization_id", organizationId)
      .eq("missed", false)
      .is("disposition", null)
      .not("proposal_id", "is", null)
      .gte("created_at", new Date(now.getTime() - 14 * DAY).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("invoices").select("amount, sent_at, created_at").eq("organization_id", organizationId).eq("status", "open").limit(500),
    supabase.from("client_message_log").select("kind, status").eq("organization_id", organizationId).gte("created_at", since30).limit(5000),
    sb.from("review_requests").select("rating, sent_to_google_at").eq("organization_id", organizationId).gte("created_at", since30),
    supabase.from("job_proposals").select("status, office_declined_from").eq("organization_id", organizationId).not("sent_at", "is", null).gte("sent_at", new Date(now.getTime() - 60 * DAY).toISOString()),
  ]);

  const clientOn = Boolean(org.data?.client_reminders_enabled);
  const quietNow = isQuiet(now, quietWindowFor(org.data ?? {}));
  const needs = (exceptions.data ?? []) as ExceptionRow[];
  const waitingCalls = (calls.data ?? []) as unknown as CallRow[];

  // KPIs, each against its planning target.
  const overdue = (invoices.data ?? []).filter((i) => invoiceDueAt({ sentAt: i.sent_at, createdAt: i.created_at }).getTime() < now.getTime());
  const overdueAmount = overdue.reduce((s, i) => s + Number(i.amount ?? 0), 0);
  const sentOf = (kind: string) => (log30.data ?? []).filter((r) => r.kind === kind && r.status === "sent").length;
  const rated = ((ratings.data ?? []) as { rating: number | null; sent_to_google_at: string | null }[]).filter((r) => r.rating != null);
  const toGoogle = rated.filter((r) => r.sent_to_google_at).length;
  const decided = (proposals60.data ?? []).filter((p) => p.status === "accepted" || (p.status === "declined" && p.office_declined_from !== "sent"));
  const accepted = decided.filter((p) => p.status === "accepted").length;
  const closeRate = decided.length > 0 ? Math.round((accepted / decided.length) * 100) : null;

  const kpis = [
    { label: "Invoices past due", value: `${overdue.length}`, sub: overdueAmount > 0 ? `$${Math.round(overdueAmount).toLocaleString("en-US")} open` : "Nothing overdue", target: "Target: 0 over 30 days", good: overdue.length === 0 },
    { label: "Sent on to Google (30 days)", value: `${toGoogle}`, sub: `${rated.length} rated, ${sentOf("review_request")} asked`, target: "Target: 4 a month", good: toGoogle >= 4 },
    { label: "Close rate on decided proposals (60 days)", value: closeRate == null ? "–" : `${closeRate}%`, sub: `${accepted} of ${decided.length}`, target: "Target: 55% (planning band)", good: closeRate != null && closeRate >= 55 },
    { label: "Follow-ups and rebooks sent (30 days)", value: `${sentOf("proposal_follow_up") + sentOf("no_show_rebook") + sentOf("win_back")}`, sub: `${sentOf("missed_call_text")} missed-call texts`, target: "Every open proposal gets 5 touches", good: true },
  ];

  const [renewals, salt] = await Promise.all([
    previewRenewals(organizationId, now).catch(() => null as CampaignPreview | null),
    previewSaltPresell(organizationId, now).catch(() => null as CampaignPreview | null),
  ]);

  const s = (key: SequenceKey) => settings[key];
  const props = (key: SequenceKey) => ({
    sequence: key,
    label: SEQUENCE_LABEL[key],
    why: SEQUENCE_WHY[key],
    enabled: s(key).enabled,
    startedAt: s(key).startedAt?.toISOString() ?? null,
  });

  return (
    <section className="grid gap-5">
      {/* What needs a person. Empty most weeks, which is the point. */}
      <div className="rounded-xl border bg-card p-4">
        <h3 className="font-bold">Needs you</h3>
        {needs.length === 0 && waitingCalls.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing. Unpaid invoices past the last reminder, ratings under five and answered calls about a proposal land here.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {needs.map((e) => (
              <li key={e.id} className="grid gap-2 rounded-lg bg-muted px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <span>
                  <span className="mr-2 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900 dark:bg-orange-900/40 dark:text-orange-100">
                    {e.kind === "collections" ? "Collections" : "Rating"}
                  </span>
                  <span className="font-semibold">{e.summary}</span>
                  {e.detail && <span className="block text-sm text-muted-foreground">{e.detail}</span>}
                </span>
                <span className="flex flex-wrap gap-2">
                  {e.job_id ? (
                    <OpenEntityButton entity={{ kind: "sales.job", id: e.job_id }} />
                  ) : e.customer_id ? (
                    <OpenEntityButton entity={{ kind: "sales.client", id: e.customer_id }} />
                  ) : null}
                  <ExceptionButtons id={e.id} />
                </span>
              </li>
            ))}
            {waitingCalls.map((c) => (
              <li key={c.id} className="grid gap-2 rounded-lg bg-muted px-3 py-2">
                <span>
                  <span className="mr-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900 dark:bg-sky-900/40 dark:text-sky-100">Call</span>
                  <span className="font-semibold">
                    {c.direction === "inbound" ? "Call from" : "Call to"} {c.customer?.name ?? "a client"}, {Math.round(c.duration_seconds / 60) || 1} min,{" "}
                    {new Date(c.created_at).toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" })}
                  </span>
                  <span className="block text-sm text-muted-foreground">What did they say about their proposal?</span>
                </span>
                {c.customer?.id && <OpenEntityButton entity={{ kind: "sales.client", id: c.customer.id }} label="Open client" />}
                <CallDisposition callId={c.id} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.label}</p>
            <p className={`font-mono text-2xl ${k.good ? "" : "text-orange-700 dark:text-orange-300"}`}>{k.value}</p>
            <p className="text-xs text-muted-foreground">{k.sub}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{k.target}</p>
          </div>
        ))}
      </div>

      {!settings.ready && (
        <p className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
          The settings for these messages aren&apos;t in the database yet (migration 0357). Everything below reads as off until it is.
        </p>
      )}
      {!clientOn && (
        <p className="rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900 dark:bg-orange-950/40 dark:text-orange-100">
          Client messages are switched off for the whole business, so none of these send even when switched on here. The master switch is in Admin › Client messaging.
        </p>
      )}
      {(!isSmsConfigured || !isResendConfigured) && (
        <p className="text-sm text-muted-foreground">
          {!isSmsConfigured ? "Texting isn't connected, so text steps fall back to email. " : ""}
          {!isResendConfigured ? "Email isn't connected — add it in Settings › Integrations." : ""}
        </p>
      )}

      <div className="grid gap-3">
        <h3 className="font-bold">Sequences</h3>
        <SequenceSwitch {...props("proposal_follow_ups")}>
          <TimingField sequence="proposal_follow_ups" enabled={s("proposal_follow_ups").enabled} label="Days after sending" field="followUpDays" value={s("proposal_follow_ups").config.followUpDays} suffix="email, text, email…" />
          <p className="mt-2 text-xs text-muted-foreground">
            A proposal stands 7 or 14 days, so touches after it expires don&apos;t send; win-back picks it up from day 30.
          </p>
        </SequenceSwitch>
        <SequenceSwitch {...props("invoice_reminders")} disabledReason={isStripeConfigured ? null : "Stripe isn't connected — add it in Settings › Integrations. Reminders would have no pay link."}>
          <TimingField sequence="invoice_reminders" enabled={s("invoice_reminders").enabled} label="Collections after" field="collectionsAfterDays" value={s("invoice_reminders").config.collectionsAfterDays} suffix="days past due" />
          <p className="mt-2 text-xs text-muted-foreground">Timing and channels for the four nudges are the &ldquo;Invoice unpaid&rdquo; rule in Admin › Client messaging.</p>
        </SequenceSwitch>
        <SequenceSwitch {...props("review_requests")} disabledReason={s("review_requests").config.googleReviewLink ? null : "Add your Google review link below first."}>
          <div className="grid gap-3">
            <ReviewLinkField enabled={s("review_requests").enabled} value={s("review_requests").config.googleReviewLink} />
            <TimingField sequence="review_requests" enabled={s("review_requests").enabled} label="Reminder after" field="reviewReminderDays" value={s("review_requests").config.reviewReminderDays} suffix="days" />
            <TimingField sequence="review_requests" enabled={s("review_requests").enabled} label="Don't ask the same client again for" field="reviewCooldownMonths" value={s("review_requests").config.reviewCooldownMonths} suffix="months" />
          </div>
        </SequenceSwitch>
        <SequenceSwitch {...props("no_show_rebook")}>
          <TimingField sequence="no_show_rebook" enabled={s("no_show_rebook").enabled} label="Days after the missed visit" field="rebookDays" value={s("no_show_rebook").config.rebookDays} />
          <p className="mt-2 text-xs text-muted-foreground">Only visits cancelled as a no-show or by the client: pick &ldquo;No-show&rdquo; or &ldquo;Client cancelled&rdquo; when cancelling. GoHighLevel no-shows count.</p>
        </SequenceSwitch>
        <SequenceSwitch {...props("win_back")}>
          <TimingField sequence="win_back" enabled={s("win_back").enabled} label="Days after the decline" field="winBackDays" value={s("win_back").config.winBackDays} />
          <p className="mt-2 text-xs text-muted-foreground">Offers a Phase 1 priced from the areas themselves. Marketing: goes only to clients who said yes to marketing on that channel.</p>
        </SequenceSwitch>
        <SequenceSwitch {...props("missed_call_text")} disabledReason={isTwilioConfigured ? null : "Twilio isn't connected — add it in Settings › Integrations."} />
        <SequenceSwitch {...props("call_logging")} disabledReason={isTwilioConfigured ? null : "Twilio isn't connected — add it in Settings › Integrations."} />
      </div>

      <div className="grid gap-3">
        <h3 className="font-bold">Campaigns you start</h3>
        <div className="rounded-xl border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <TimingField sequence="renewals" enabled={s("renewals").enabled} label="Price rise" field="escalatorPct" value={s("renewals").config.escalatorPct} suffix="%" />
            <TimingField sequence="renewals" enabled={s("renewals").enabled} label="Season starts (MM-DD)" field="seasonStart" value={s("renewals").config.seasonStart} />
            <TimingField sequence="renewals" enabled={s("renewals").enabled} label="Send this long before" field="renewalLeadDays" value={s("renewals").config.renewalLeadDays} suffix="days" />
          </div>
        </div>
        {renewals ? (
          <CampaignCard title="Renewal proposals" why={SEQUENCE_WHY.renewals} preview={renewals} quietNow={quietNow} />
        ) : (
          <p className="text-sm text-muted-foreground">Renewals couldn&apos;t be worked out just now.</p>
        )}
        {salt ? (
          <CampaignCard title="Salt pre-sell" why={SEQUENCE_WHY.salt_presell} preview={salt} quietNow={quietNow} />
        ) : (
          <p className="text-sm text-muted-foreground">The salt list couldn&apos;t be worked out just now.</p>
        )}
      </div>
    </section>
  );
}

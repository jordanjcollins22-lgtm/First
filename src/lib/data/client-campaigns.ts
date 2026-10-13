import { randomBytes } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";
import { isResendConfigured, isSmsConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { fitSms } from "@/lib/client-message-templates";
import { expiryOf } from "@/lib/proposal-validity";
import { alreadySent, contactsFor, quietWindowFor, sendClientMessage, type ClientContact } from "@/lib/data/client-messaging";
import { loadSequenceSettings, untyped } from "@/lib/data/client-automations";
import { canReach } from "@/lib/client-automations/channels";
import {
  nextSeason,
  pickRenewals,
  renewalKey,
  renewalMessage,
  saltPresellKey,
  saltPresellMessage,
  snowSeason,
  type RenewalOffer,
  type RenewalSource,
} from "@/lib/client-automations/campaigns";
import type { Channel, SendBasis } from "@/lib/client-consent";
import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * The two campaigns the owner starts by hand: renewal proposals for last
 * season's recurring clients, and the snow and salt pre-sell. Each has a
 * preview (who, at what price, on which channel, or why not) and a run that
 * sends exactly what the preview showed. Both are once a season per client:
 * the keys carry the season, so pressing the button twice sends nothing twice.
 *
 * These are the one place the go-live guard does not apply: the owner is
 * deliberately reaching past clients, with the list in front of them.
 */

export type CampaignKey = "renewals" | "salt_presell";

export interface CampaignRow {
  customerId: string;
  name: string;
  /** What they'd get: "$1,200 → $1,248, Lawn mowing" or "Past client". */
  detail: string;
  channels: Channel[];
  /** Why they won't get it, when they won't. */
  skip: string | null;
}

export interface CampaignPreview {
  campaign: CampaignKey;
  season: string;
  /** Renewals: when the season starts and when the campaign is due. */
  startsOn?: string;
  dueOn?: string;
  rows: CampaignRow[];
  willSend: number;
  lastRun: { at: string; sent: number } | null;
}

/** Renewals: an email on the relationship; a text only with a marketing yes. */
const RENEWAL_BASIS: Record<Channel, SendBasis> = { email: "service", sms: "marketing" };
/** The pre-sell is marketing on both channels. */
const SALT_BASIS: Record<Channel, SendBasis> = { email: "marketing", sms: "marketing" };

function channelsFor(contact: ClientContact | undefined, basis: Record<Channel, SendBasis>): { channels: Channel[]; skip: string | null } {
  if (!contact) return { channels: [], skip: "Contact not found" };
  if (contact.doNotContact) return { channels: [], skip: "Marked do not contact" };
  const channels = (["email", "sms"] as const).filter((c) => canReach(contact, c, basis[c], c === "sms" ? isSmsConfigured : isResendConfigured));
  if (channels.length > 0) return { channels, skip: null };
  const reason =
    !contact.email && !contact.phone
      ? "No email or phone on file"
      : basis.email === "marketing"
        ? "Hasn't said yes to marketing"
        : !isResendConfigured
          ? "Email isn't set up"
          : "Can't be reached";
  return { channels: [], skip: reason };
}

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

async function lastRunOf(organizationId: string, campaign: CampaignKey, season: string) {
  const sb = untyped(createAdminClient());
  const { data } = await sb
    .from("client_campaign_runs")
    .select("started_at, sent")
    .eq("organization_id", organizationId)
    .eq("campaign", campaign)
    .eq("season", season)
    .order("started_at", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as { started_at: string; sent: number } | undefined;
  return row ? { at: row.started_at, sent: row.sent } : null;
}

/* -------------------------------------------------------------------------
 * Renewals
 * ---------------------------------------------------------------------- */

async function renewalOffers(organizationId: string, now: Date): Promise<{ season: string; startsOn: string; dueOn: string; offers: RenewalOffer[] }> {
  const admin = createAdminClient();
  const settings = await loadSequenceSettings(admin, organizationId);
  const cfg = settings.renewals.config;
  const { season, startsOn, dueOn } = nextSeason(now, cfg.seasonStart, cfg.renewalLeadDays);

  // Last season's accepted work that was actually done.
  const { data } = await admin
    .from("job_proposals")
    .select("job_id, total_cost, discount_amount, responded_at, updated_at, scope_snapshot, job:jobs!inner(id, completed_at, property:properties!inner(id, address, customer_id, customer:customers!inner(name)))")
    .eq("organization_id", organizationId)
    .eq("status", "accepted")
    .not("job.completed_at", "is", null)
    .gte("updated_at", new Date(now.getTime() - 548 * 86_400_000).toISOString())
    .limit(1000);
  type Row = {
    job_id: string; total_cost: number | null; discount_amount: number | null; responded_at: string | null; updated_at: string;
    scope_snapshot: ProposalZoneSnapshot[] | null;
    job: { id: string; completed_at: string | null; property: { id: string; address: string; customer_id: string | null; customer: { name: string | null } | null } | null } | null;
  };
  const sources: RenewalSource[] = [];
  for (const r of (data ?? []) as unknown as Row[]) {
    const p = r.job?.property;
    if (!p?.customer_id || !r.job?.completed_at) continue;
    // Renewals of renewals are fine; renewals of this season's renewal are not.
    sources.push({
      customerId: p.customer_id,
      propertyId: p.id,
      jobId: r.job_id,
      address: p.address,
      clientName: p.customer?.name?.trim() || "Client",
      acceptedAt: r.responded_at ?? r.updated_at,
      snapshot: r.scope_snapshot ?? [],
      total: Number(r.total_cost ?? 0),
    });
  }
  return { season, startsOn, dueOn, offers: pickRenewals(sources, cfg.escalatorPct, now) };
}

const renewalJobName = (address: string, season: string) => `${address}, ${season} season renewal`;

export async function previewRenewals(organizationId: string, now = new Date()): Promise<CampaignPreview> {
  const { season, startsOn, dueOn, offers } = await renewalOffers(organizationId, now);
  const contacts = await contactsFor(offers.map((o) => o.customerId));
  const sent = await alreadySent(organizationId, offers.flatMap((o) => [renewalKey(o.customerId, season, "email"), renewalKey(o.customerId, season, "sms")]));
  const rows: CampaignRow[] = offers.map((o) => {
    const reach = channelsFor(contacts.get(o.customerId), RENEWAL_BASIS);
    const done = sent.has(renewalKey(o.customerId, season, "email")) || sent.has(renewalKey(o.customerId, season, "sms"));
    return {
      customerId: o.customerId,
      name: o.clientName,
      detail: `${money(o.lastCents)} → ${money(o.newCents)}: ${o.areas.map((a) => a.serviceLabel).join(", ")}`,
      channels: done ? [] : reach.channels,
      skip: done ? `Already sent for ${season}` : reach.skip,
    };
  });
  return { campaign: "renewals", season, startsOn, dueOn, rows, willSend: rows.filter((r) => !r.skip).length, lastRun: await lastRunOf(organizationId, "renewals", season) };
}

/**
 * Makes each renewal a real proposal (a new job for next season, at the
 * escalated prices, sent and valid 14 days) and sends its link. The
 * proposal then follows the normal path: follow-ups, accept, invoice.
 */
export async function runRenewals(organizationId: string, profileId: string, origin: string, now = new Date()): Promise<{ sent: number; skipped: number }> {
  const admin = createAdminClient();
  const sb = untyped(admin);
  const { data: org } = await admin.from("organizations").select("id, name, reminder_time_zone, reminder_quiet_start, reminder_quiet_end").eq("id", organizationId).maybeSingle();
  if (!org) return { sent: 0, skipped: 0 };
  const window = quietWindowFor(org);
  const { season, offers } = await renewalOffers(organizationId, now);
  const contacts = await contactsFor(offers.map((o) => o.customerId));
  let sent = 0;
  let skipped = 0;

  for (const offer of offers) {
    const contact = contacts.get(offer.customerId);
    const reach = channelsFor(contact, RENEWAL_BASIS);
    if (!contact || reach.channels.length === 0) {
      skipped += 1;
      continue;
    }
    const name = renewalJobName(offer.address, season);
    // One renewal job per property per season, however often this is pressed.
    const { data: existing } = await admin.from("jobs").select("id").eq("property_id", offer.propertyId).eq("name", name).maybeSingle();
    let token: string | null = null;
    if (existing) {
      const { data: p } = await admin.from("job_proposals").select("token").eq("job_id", existing.id).maybeSingle();
      token = p?.token ?? null;
    } else {
      const { data: job, error: jobError } = await admin
        .from("jobs")
        .insert({
          property_id: offer.propertyId,
          name,
          status: "quoted",
          evaluation_status: "completed",
          client_notes: `Renewal of last season's work (job ${offer.fromJobId}) at ${money(offer.newCents)}, started from Sales › Automated messages.`,
        })
        .select("id")
        .single();
      if (jobError || !job) {
        log.error("renewals.job_failed", jobError, { customerId: offer.customerId });
        skipped += 1;
        continue;
      }
      token = randomBytes(16).toString("hex");
      const at = now.toISOString();
      const { error: proposalError } = await admin.from("job_proposals").insert({
        job_id: job.id,
        organization_id: organizationId,
        token,
        status: "sent",
        total_cost: offer.newCents / 100,
        scope_snapshot: offer.areas as never,
        generated_at: at,
        approved_at: at,
        sent_at: at,
        valid_days: 14,
        expires_at: expiryOf(now, 14).toISOString(),
      });
      if (proposalError) {
        log.error("renewals.proposal_failed", proposalError, { jobId: job.id });
        skipped += 1;
        continue;
      }
    }
    if (!token) {
      skipped += 1;
      continue;
    }
    for (const channel of reach.channels) {
      const msg = renewalMessage({
        channel,
        businessName: org.name,
        clientName: contact.name,
        address: offer.address,
        season,
        newCents: offer.newCents,
        link: `${origin}/proposal/${token}`,
        includeOptOut: channel === "sms" && !contact.textedBefore,
        unsubscribeUrl: contact.unsubscribeToken ? `${origin}/u/${contact.unsubscribeToken}` : null,
      });
      const outcome = await sendClientMessage(
        {
          organizationId,
          customerId: contact.id,
          channel,
          basis: RENEWAL_BASIS[channel],
          kind: "renewal",
          referenceId: null,
          dedupeKey: renewalKey(offer.customerId, season, channel),
          subject: msg.subject,
          body: channel === "sms" ? fitSms(msg.body) : msg.body,
          // Pressed by the owner after reading the list: that is the approval.
          automatic: false,
        },
        contact,
        window,
        now
      );
      if (outcome.sent) sent += 1;
    }
  }

  await sb.from("client_campaign_runs").insert({ organization_id: organizationId, campaign: "renewals", season, started_by: profileId, audience: offers.length, sent, skipped });
  return { sent, skipped };
}

/* -------------------------------------------------------------------------
 * Snow and salt pre-sell
 * ---------------------------------------------------------------------- */

const BUSINESS_TAG = /hoa|commercial|property manag|business|association|condo/i;

async function saltAudience(organizationId: string, now: Date): Promise<{ id: string; name: string; business: boolean; why: string }[]> {
  const admin = createAdminClient();
  const season = snowSeason(now);
  const seasonStart = `${season.slice(0, 4)}-06-01`;
  const [customers, done, salted] = await Promise.all([
    admin.from("customers").select("id, name, contact_type, tags, do_not_contact").eq("organization_id", organizationId).limit(5000),
    admin
      .from("jobs")
      .select("property:properties!inner(customer_id, customer:customers!inner(organization_id))")
      .eq("property.customer.organization_id", organizationId)
      .not("completed_at", "is", null)
      .limit(5000),
    admin.from("salt_orders").select("customer_id, paid_at").eq("organization_id", organizationId).not("paid_at", "is", null),
  ]);
  const pastClients = new Set(((done.data ?? []) as unknown as { property: { customer_id: string } | null }[]).map((r) => r.property?.customer_id));
  const saltPaid = (salted.data ?? []) as { customer_id: string | null; paid_at: string }[];
  const boughtThisSeason = new Set(saltPaid.filter((s) => s.paid_at >= seasonStart).map((s) => s.customer_id));
  const boughtBefore = new Set(saltPaid.map((s) => s.customer_id));

  const out: { id: string; name: string; business: boolean; why: string }[] = [];
  for (const c of customers.data ?? []) {
    if (boughtThisSeason.has(c.id)) continue;
    const business = c.contact_type === "business" || (c.tags ?? []).some((t) => BUSINESS_TAG.test(t));
    const past = pastClients.has(c.id) || boughtBefore.has(c.id);
    if (!past && !business) continue;
    out.push({ id: c.id, name: c.name?.trim() || "Client", business, why: boughtBefore.has(c.id) ? "Bought salt before" : business ? "HOA or business contact" : "Past client" });
  }
  return out;
}

export async function previewSaltPresell(organizationId: string, now = new Date()): Promise<CampaignPreview> {
  const season = snowSeason(now);
  const audience = await saltAudience(organizationId, now);
  const contacts = await contactsFor(audience.map((a) => a.id));
  const sent = await alreadySent(organizationId, audience.flatMap((a) => [saltPresellKey(a.id, season, "email"), saltPresellKey(a.id, season, "sms")]));
  const rows: CampaignRow[] = audience.map((a) => {
    const reach = channelsFor(contacts.get(a.id), SALT_BASIS);
    const channels = reach.channels.filter((c) => !sent.has(saltPresellKey(a.id, season, c)));
    const done = reach.channels.length > 0 && channels.length === 0;
    return { customerId: a.id, name: a.name, detail: a.why, channels, skip: done ? `Already sent for ${season}` : reach.skip };
  });
  return { campaign: "salt_presell", season, rows, willSend: rows.filter((r) => !r.skip).length, lastRun: await lastRunOf(organizationId, "salt_presell", season) };
}

export async function runSaltPresell(organizationId: string, profileId: string, origin: string, now = new Date()): Promise<{ sent: number; skipped: number }> {
  const admin = createAdminClient();
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, salt_enabled, reminder_time_zone, reminder_quiet_start, reminder_quiet_end")
    .eq("id", organizationId)
    .maybeSingle();
  if (!org) return { sent: 0, skipped: 0 };
  const window = quietWindowFor(org);
  const season = snowSeason(now);
  const audience = await saltAudience(organizationId, now);
  const contacts = await contactsFor(audience.map((a) => a.id));
  let sent = 0;
  let skipped = 0;
  for (const person of audience) {
    const contact = contacts.get(person.id);
    const reach = channelsFor(contact, SALT_BASIS);
    if (!contact || reach.channels.length === 0) {
      skipped += 1;
      continue;
    }
    for (const channel of reach.channels) {
      const msg = saltPresellMessage({
        channel,
        businessName: org.name,
        clientName: contact.name,
        season,
        link: `${origin}/salt`,
        business: person.business,
        includeOptOut: channel === "sms" && !contact.textedBefore,
        unsubscribeUrl: contact.unsubscribeToken ? `${origin}/u/${contact.unsubscribeToken}` : null,
      });
      const outcome = await sendClientMessage(
        {
          organizationId,
          customerId: contact.id,
          channel,
          basis: SALT_BASIS[channel],
          kind: "salt_presell",
          referenceId: null,
          dedupeKey: saltPresellKey(person.id, season, channel),
          subject: msg.subject,
          body: channel === "sms" ? fitSms(msg.body) : msg.body,
          automatic: false,
        },
        contact,
        window,
        now
      );
      if (outcome.sent) sent += 1;
    }
  }
  await untyped(admin)
    .from("client_campaign_runs")
    .insert({ organization_id: organizationId, campaign: "salt_presell", season, started_by: profileId, audience: audience.length, sent, skipped, detail: { salt_page_on: Boolean(org.salt_enabled) } });
  return { sent, skipped };
}

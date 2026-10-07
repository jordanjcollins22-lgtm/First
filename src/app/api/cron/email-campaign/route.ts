import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseAdminConfigured } from "@/lib/env";
import { authorizeCron } from "@/lib/cron-auth";
import { sendEmail } from "@/lib/email/send";
import { campaignStats, getReadiness, variantStats } from "@/lib/data/campaigns";
import { composeCampaignEmail } from "@/lib/data/campaign-send";
import { chooseVariant, pauseReason, rampFrom, todaysCap } from "@/lib/campaign";
import { log, maskEmail } from "@/lib/log";

/**
 * Today's batch of every running campaign.
 *
 * Runs once a day. Each campaign gets its allowance for the day from the
 * ramp, minus anything already sent today, and each person gets the
 * wording the numbers say to try next. Before a single email goes, the
 * campaign's bounces and complaints are checked, and it pauses itself if
 * they are past the line. A campaign with nobody left to write to is done.
 *
 * Every person is checked again at send time: unsubscribed since they
 * were queued, marked do not contact, no address. The queue is a plan;
 * the send is the fact.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return NextResponse.json({ error: "Supabase admin isn't configured." }, { status: 503 });
  }
  const refused = authorizeCron(request, "email-campaign");
  if (refused) return refused;

  const admin = createAdminClient();
  const { data: campaigns } = await admin.from("email_campaigns").select("*").eq("status", "running");
  if (!campaigns || campaigns.length === 0) return NextResponse.json({ campaigns: 0, sent: 0 });

  const report: Record<string, unknown>[] = [];

  for (const campaign of campaigns) {
    const readiness = await getReadiness(campaign.organization_id);
    if (!readiness.ready) {
      log.warn("campaign.not_ready", { campaignId: campaign.id, problems: readiness.problems });
      report.push({ id: campaign.id, waiting: readiness.problems[0] });
      continue;
    }

    const stats = await campaignStats(admin, campaign.id);
    const stop = pauseReason(stats);
    if (stop) {
      await admin.from("email_campaigns").update({ status: "paused", paused_reason: stop, updated_at: new Date().toISOString() }).eq("id", campaign.id);
      log.warn("campaign.paused", { campaignId: campaign.id, reason: stop, ...stats });
      report.push({ id: campaign.id, paused: stop });
      continue;
    }
    if (stats.queued === 0) {
      await admin.from("email_campaigns").update({ status: "done", finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", campaign.id);
      log.info("campaign.done", { campaignId: campaign.id, ...stats });
      report.push({ id: campaign.id, done: true });
      continue;
    }

    // Today's allowance, less what already went today if this ran twice.
    const todayKey = new Date().toISOString().slice(0, 10);
    const { count: sentToday } = await admin
      .from("email_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .gte("sent_at", `${todayKey}T00:00:00Z`);
    const dayIndex = stats.sendDays - ((sentToday ?? 0) > 0 ? 1 : 0);
    const allowance = todaysCap(rampFrom(campaign.ramp), dayIndex) - (sentToday ?? 0);
    if (allowance <= 0) {
      report.push({ id: campaign.id, sent: 0, note: "Today's allowance is used." });
      continue;
    }

    const [{ data: org }, variants, { data: queued }] = await Promise.all([
      admin
        .from("organizations")
        .select("name, business_phone, business_address, business_email, public_base_url")
        .eq("id", campaign.organization_id)
        .single(),
      variantStats(admin, campaign.id),
      admin
        .from("email_campaign_recipients")
        .select("id, customer_id, property_id, email, name, code")
        .eq("campaign_id", campaign.id)
        .eq("status", "queued")
        .order("created_at")
        .limit(allowance),
    ]);
    if (!org || !queued || queued.length === 0) continue;

    const customerIds = queued.map((r) => r.customer_id).filter((id): id is string => Boolean(id));
    const propertyIds = queued.map((r) => r.property_id).filter((id): id is string => Boolean(id));
    const [{ data: customers }, { data: revoked }, { data: properties }] = await Promise.all([
      admin.from("customers").select("id, do_not_contact, unsubscribe_token").in("id", customerIds),
      admin.from("client_consent").select("customer_id").eq("channel", "email").eq("state", "revoked").in("customer_id", customerIds),
      propertyIds.length > 0
        ? admin.from("properties").select("id, address, acreage, sqft").in("id", propertyIds)
        : Promise.resolve({ data: [] as { id: string; address: string; acreage: number | null; sqft: number | null }[] }),
    ]);
    const customerById = new Map((customers ?? []).map((c) => [c.id, c]));
    const revokedIds = new Set((revoked ?? []).map((r) => r.customer_id));
    const propertyById = new Map((properties ?? []).map((p) => [p.id, p]));

    let sent = 0;
    let skipped = 0;
    for (const recipient of queued) {
      const now = new Date().toISOString();
      const customer = recipient.customer_id ? customerById.get(recipient.customer_id) : null;
      if (customer?.do_not_contact || (recipient.customer_id && revokedIds.has(recipient.customer_id))) {
        await admin.from("email_campaign_recipients").update({ status: "unsubscribed", skip_reason: "asked us to stop" }).eq("id", recipient.id);
        skipped += 1;
        continue;
      }

      const property = recipient.property_id ? propertyById.get(recipient.property_id) ?? null : null;
      const canPrice = Boolean(property && property.acreage);
      const variant = chooseVariant(variants, Math.random(), canPrice);
      if (!variant) {
        await admin.from("email_campaign_recipients").update({ status: "skipped", skip_reason: "no wording enabled" }).eq("id", recipient.id);
        skipped += 1;
        continue;
      }
      const words = variants.find((v) => v.id === variant.id)!;

      // Claimed before it goes, so a second run cannot send it again.
      const { data: claimed } = await admin
        .from("email_campaign_recipients")
        .update({ status: "sent", sent_at: now, variant_id: variant.id })
        .eq("id", recipient.id)
        .eq("status", "queued")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      const composed = composeCampaignEmail({
        campaign,
        variant: { subject: words.subject, body: words.body, needs_price: words.needsPrice },
        organization: org,
        recipient: { name: recipient.name, code: recipient.code, email: recipient.email },
        property,
        unsubscribeToken: customer?.unsubscribe_token ?? null,
      });

      const result = await sendEmail({
        organizationId: campaign.organization_id,
        to: recipient.email,
        subject: composed.subject,
        html: composed.html,
        text: composed.text,
        stream: "marketing",
      });

      if (result.ok) {
        await admin
          .from("email_campaign_recipients")
          .update({ provider_id: result.id, lawn_sqft: composed.lawnSqft, price_cents: composed.priceCents })
          .eq("id", recipient.id);
        // A wording that just went out counts for the next choice.
        variant.sent += 1;
        sent += 1;
        log.info("campaign.sent", { campaignId: campaign.id, recipientId: recipient.id, variant: variant.key, to: maskEmail(recipient.email) });
      } else {
        await admin
          .from("email_campaign_recipients")
          .update({ status: "skipped", skip_reason: result.message, sent_at: null, variant_id: null })
          .eq("id", recipient.id);
        skipped += 1;
        log.error("campaign.send_failed", undefined, { campaignId: campaign.id, recipientId: recipient.id, message: result.message });
      }
    }

    log.info("cron.email_campaign", { campaignId: campaign.id, sent, skipped, allowance, dayIndex });
    report.push({ id: campaign.id, sent, skipped, allowance });
  }

  return NextResponse.json({ campaigns: campaigns.length, report });
}

"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { enqueueAudience, getReadiness, looksLikeEmail } from "@/lib/data/campaigns";
import { composeCampaignEmail } from "@/lib/data/campaign-send";
import { sendEmail } from "@/lib/email/send";
import { DEFAULT_PRICING, DEFAULT_VARIANTS, pricingFrom, type AerationPricing } from "@/lib/campaign";
import { log } from "@/lib/log";

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function editor() {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false as const, error: "Not signed in." };
  if (!profile.roles.includes("admin") && !profile.roles.includes("owner")) {
    return { ok: false as const, error: "Only an owner or admin can run campaigns." };
  }
  return { ok: true as const, profile };
}

/** A campaign with the three default wordings, ready to edit. */
export async function createCampaign(input: {
  name: string;
  offerDollars: string;
  codeExpiresOn: string;
  pricing: Partial<AerationPricing>;
}): Promise<Result & { id?: string }> {
  const who = await editor();
  if (!who.ok) return who;
  const name = input.name.trim() || "Aeration and overseeding";
  const offerCents = Math.round(Number(input.offerDollars) * 100);
  if (!Number.isFinite(offerCents) || offerCents < 0) return { ok: false, error: "The credit needs to be a dollar amount." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.codeExpiresOn)) return { ok: false, error: "Pick the day the code expires." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_campaigns")
    .insert({
      organization_id: who.profile.organization_id,
      name,
      offer_cents: offerCents,
      code_expires_on: input.codeExpiresOn,
      pricing: pricingFrom({ ...DEFAULT_PRICING, ...input.pricing }) as unknown as Record<string, number>,
      created_by: who.profile.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  const { error: variantError } = await supabase.from("email_campaign_variants").insert(
    DEFAULT_VARIANTS.map((v) => ({
      campaign_id: data.id,
      organization_id: who.profile.organization_id,
      key: v.key,
      name: v.name,
      subject: v.subject,
      body: v.body,
      needs_price: v.needsPrice,
    }))
  );
  if (variantError) return { ok: false, error: variantError.message };

  log.info("campaign.created", { campaignId: data.id, offerCents, codeExpiresOn: input.codeExpiresOn });
  revalidatePath("/admin/campaigns");
  return { ok: true, id: data.id };
}

export async function saveVariant(input: { id: string; subject: string; body: string; enabled: boolean }): Promise<Result> {
  const who = await editor();
  if (!who.ok) return who;
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) return { ok: false, error: "The subject cannot be empty." };
  if (!body) return { ok: false, error: "The email needs a body." };
  if (/—/.test(subject + body)) return { ok: false, error: "No em dashes. Use a comma or a full stop." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("email_campaign_variants")
    .update({ subject, body, enabled: input.enabled, updated_at: new Date().toISOString() })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/campaigns");
  return { ok: true };
}

export async function saveCampaignSettings(input: {
  id: string;
  offerDollars: string;
  codeExpiresOn: string;
  pricing: Partial<AerationPricing>;
}): Promise<Result> {
  const who = await editor();
  if (!who.ok) return who;
  const offerCents = Math.round(Number(input.offerDollars) * 100);
  if (!Number.isFinite(offerCents) || offerCents < 0) return { ok: false, error: "The credit needs to be a dollar amount." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.codeExpiresOn)) return { ok: false, error: "Pick the day the code expires." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("email_campaigns")
    .update({
      offer_cents: offerCents,
      code_expires_on: input.codeExpiresOn,
      pricing: pricingFrom(input.pricing) as unknown as Record<string, number>,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/campaigns");
  return { ok: true };
}

/**
 * Start sending.
 *
 * Queues everyone eligible, then hands the campaign to the daily cron,
 * which sends today's allowance within the hour of its run. Refused when
 * the domain is not ready, because the first thing a campaign can do to
 * the business is get its domain marked as spam.
 */
export async function startCampaign(id: string): Promise<Result> {
  const who = await editor();
  if (!who.ok) return who;
  const readiness = await getReadiness(who.profile.organization_id);
  if (!readiness.ready) return { ok: false, error: readiness.problems[0] };

  const supabase = await createClient();
  const queued = await enqueueAudience(supabase, id, who.profile.organization_id);
  const { error } = await supabase
    .from("email_campaigns")
    .update({ status: "running", paused_reason: null, started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", who.profile.organization_id);
  if (error) return { ok: false, error: error.message };
  log.info("campaign.started", { campaignId: id, queued });
  revalidatePath("/admin/campaigns");
  return { ok: true, message: `${queued} people queued. The first batch goes out on the next daily run.` };
}

export async function setCampaignStatus(id: string, status: "paused" | "running" | "done"): Promise<Result> {
  const who = await editor();
  if (!who.ok) return who;
  const supabase = await createClient();
  const { error } = await supabase
    .from("email_campaigns")
    .update({
      status,
      paused_reason: status === "paused" ? "Paused by hand." : null,
      finished_at: status === "done" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("organization_id", who.profile.organization_id);
  if (error) return { ok: false, error: error.message };
  log.info("campaign.status", { campaignId: id, status });
  revalidatePath("/admin/campaigns");
  return { ok: true };
}

/** One wording, to one of our own addresses, exactly as a client would get it. */
export async function sendCampaignTest(input: { campaignId: string; variantId: string; to: string }): Promise<Result> {
  const who = await editor();
  if (!who.ok) return who;
  if (!looksLikeEmail(input.to)) return { ok: false, error: "That does not look like an email address." };
  const organization = await getCurrentOrganization();
  const supabase = await createClient();
  const [{ data: campaign }, { data: variant }] = await Promise.all([
    supabase.from("email_campaigns").select("*").eq("id", input.campaignId).maybeSingle(),
    supabase.from("email_campaign_variants").select("*").eq("id", input.variantId).maybeSingle(),
  ]);
  if (!campaign || !variant) return { ok: false, error: "Could not find that wording." };

  const composed = composeCampaignEmail({
    campaign,
    variant,
    organization: {
      name: organization.name,
      business_phone: organization.business_phone ?? null,
      business_address: organization.business_address ?? null,
      business_email: organization.business_email ?? null,
      public_base_url: organization.public_base_url ?? null,
    },
    recipient: { name: who.profile.full_name ?? "there", code: "LAWN-TEST", email: input.to },
    property: { address: "1613 Bimini Drive, Bel Air", acreage: 0.25, sqft: 2000 },
    unsubscribeToken: null,
  });
  const result = await sendEmail({
    organizationId: who.profile.organization_id,
    to: input.to,
    subject: `[Test] ${composed.subject}`,
    html: composed.html,
    text: composed.text,
    stream: "marketing",
  });
  if (!result.ok) return { ok: false, error: result.message };
  return { ok: true, message: `Sent to ${input.to}.` };
}

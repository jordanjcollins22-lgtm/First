import { randomBytes } from "crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { isResendConfigured } from "@/lib/env";
import {
  pricingFrom,
  rampFrom,
  todaysCap,
  variantShares,
  type AerationPricing,
  type CampaignStats,
  type RampPlan,
  type VariantStats,
} from "@/lib/campaign";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/** A wording with its numbers and its words. */
export interface CampaignVariantView extends VariantStats {
  name: string;
  subject: string;
  body: string;
}

/** What has to be true before a single email can go. */
export interface Readiness {
  resend: boolean;
  /** The verified marketing domain, or null. */
  marketingDomain: string | null;
  /** The address it sends from, or null. */
  sender: string | null;
  postalAddress: boolean;
  ready: boolean;
  problems: string[];
}

export interface CampaignView {
  id: string;
  name: string;
  status: "draft" | "running" | "paused" | "done";
  offerCents: number;
  codeExpiresOn: string;
  serviceLabel: string;
  pricing: AerationPricing;
  ramp: RampPlan;
  pausedReason: string | null;
  startedAt: string | null;
  stats: CampaignStats;
  variants: CampaignVariantView[];
  /** The share of the next sends each wording is working to. */
  shares: Record<string, number>;
  todaysCap: number;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A code a person can read out over the phone: LAWN-7K3Q. */
export function makeCode(): string {
  const bytes = randomBytes(4);
  let out = "";
  for (let i = 0; i < 4; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `LAWN-${out}`;
}

/** Whether the business can send marketing email at all, and why not. */
export async function getReadiness(organizationId: string): Promise<Readiness> {
  const admin = createAdminClient();
  const [{ data: domain }, { data: org }] = await Promise.all([
    admin
      .from("email_domains")
      .select("id, hostname, status")
      .eq("organization_id", organizationId)
      .eq("stream", "marketing")
      .eq("status", "verified")
      .maybeSingle(),
    admin.from("organizations").select("business_address").eq("id", organizationId).maybeSingle(),
  ]);
  let sender: string | null = null;
  if (domain) {
    const { data } = await admin
      .from("email_senders")
      .select("address")
      .eq("domain_id", domain.id)
      .eq("is_default", true)
      .maybeSingle();
    sender = data?.address ?? null;
  }
  const postalAddress = Boolean(org?.business_address?.trim());
  const problems: string[] = [];
  if (!isResendConfigured) problems.push("The email provider key is not set. Add RESEND_API_KEY in Vercel and redeploy.");
  if (!domain) problems.push("No verified marketing domain. Set up news.jslandscapingmd.com under Settings, Email, and wait for the DNS check to pass.");
  if (domain && !sender) problems.push(`${domain.hostname} is verified but has no address to send from. Add one under Settings, Email.`);
  if (!postalAddress) problems.push("No business postal address. Every marketing email must carry one. Add it under Settings, Business.");
  return {
    resend: isResendConfigured,
    marketingDomain: domain?.hostname ?? null,
    sender,
    postalAddress,
    ready: problems.length === 0,
    problems,
  };
}

/** How many people the campaign would write to today. */
export async function countAudience(client: Client, organizationId: string): Promise<number> {
  const { data: customers } = await client
    .from("customers")
    .select("id, email, do_not_contact")
    .eq("organization_id", organizationId);
  const { data: revoked } = await client
    .from("client_consent")
    .select("customer_id")
    .eq("channel", "email")
    .eq("state", "revoked");
  const out = new Set((revoked ?? []).map((r) => r.customer_id));
  return (customers ?? []).filter((c) => looksLikeEmail(c.email) && !c.do_not_contact && !out.has(c.id)).length;
}

export function looksLikeEmail(value: string | null | undefined): value is string {
  return Boolean(value && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value));
}

/**
 * Everyone the campaign will write to, queued with their own code.
 *
 * One row per email address, so a person with two customer records gets
 * one offer. Anyone already queued is left alone, so starting twice does
 * not queue twice.
 */
export async function enqueueAudience(client: Client, campaignId: string, organizationId: string): Promise<number> {
  const [{ data: customers }, { data: revoked }, { data: existing }, { data: properties }] = await Promise.all([
    client.from("customers").select("id, name, email, do_not_contact, created_at").eq("organization_id", organizationId),
    client.from("client_consent").select("customer_id").eq("channel", "email").eq("state", "revoked"),
    client.from("email_campaign_recipients").select("email").eq("campaign_id", campaignId),
    client.from("properties").select("id, customer_id, created_at").order("created_at", { ascending: false }),
  ]);
  const out = new Set((revoked ?? []).map((r) => r.customer_id));
  const already = new Set((existing ?? []).map((r) => r.email.toLowerCase()));
  const propertyOf = new Map<string, string>();
  for (const p of properties ?? []) {
    if (p.customer_id && !propertyOf.has(p.customer_id)) propertyOf.set(p.customer_id, p.id);
  }

  const rows: Database["public"]["Tables"]["email_campaign_recipients"]["Insert"][] = [];
  const seen = new Set<string>();
  for (const c of customers ?? []) {
    if (!looksLikeEmail(c.email) || c.do_not_contact || out.has(c.id)) continue;
    const email = c.email.trim().toLowerCase();
    if (already.has(email) || seen.has(email)) continue;
    seen.add(email);
    rows.push({
      campaign_id: campaignId,
      organization_id: organizationId,
      customer_id: c.id,
      property_id: propertyOf.get(c.id) ?? null,
      email,
      name: c.name,
      code: makeCode(),
    });
  }
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await client.from("email_campaign_recipients").insert(rows.slice(i, i + 200));
    if (error) throw error;
  }
  return rows.length;
}

/** The numbers, from the recipients, in one read. */
export async function campaignStats(client: Client, campaignId: string): Promise<CampaignStats> {
  const { data } = await client
    .from("email_campaign_recipients")
    .select("status, sent_at, clicked_at, booked_at, price_cents")
    .eq("campaign_id", campaignId);
  const stats: CampaignStats = { queued: 0, sent: 0, skipped: 0, bounced: 0, complained: 0, unsubscribed: 0, clicked: 0, booked: 0, bookedCents: 0, sendDays: 0 };
  const days = new Set<string>();
  for (const r of data ?? []) {
    if (r.status === "queued") stats.queued += 1;
    else if (r.status === "skipped") stats.skipped += 1;
    else if (r.status === "bounced") stats.bounced += 1;
    else if (r.status === "complained") stats.complained += 1;
    else if (r.status === "unsubscribed") stats.unsubscribed += 1;
    // Sent counts everything that went out, however it ended up.
    if (r.sent_at) {
      stats.sent += 1;
      days.add(r.sent_at.slice(0, 10));
    }
    if (r.clicked_at) stats.clicked += 1;
    if (r.booked_at) {
      stats.booked += 1;
      stats.bookedCents += r.price_cents ?? 0;
    }
  }
  stats.sendDays = days.size;
  return stats;
}

export async function variantStats(client: Client, campaignId: string): Promise<CampaignVariantView[]> {
  const [{ data: variants }, { data: recipients }] = await Promise.all([
    client.from("email_campaign_variants").select("*").eq("campaign_id", campaignId).order("key"),
    client.from("email_campaign_recipients").select("variant_id, sent_at, clicked_at, booked_at").eq("campaign_id", campaignId).not("sent_at", "is", null),
  ]);
  const tally = new Map<string, { sent: number; clicked: number; booked: number }>();
  for (const r of recipients ?? []) {
    if (!r.variant_id) continue;
    const t = tally.get(r.variant_id) ?? { sent: 0, clicked: 0, booked: 0 };
    t.sent += 1;
    if (r.clicked_at) t.clicked += 1;
    if (r.booked_at) t.booked += 1;
    tally.set(r.variant_id, t);
  }
  return (variants ?? []).map((v) => ({
    id: v.id,
    key: v.key,
    name: v.name,
    subject: v.subject,
    body: v.body,
    enabled: v.enabled,
    needsPrice: v.needs_price,
    ...(tally.get(v.id) ?? { sent: 0, clicked: 0, booked: 0 }),
  }));
}

export async function campaignView(client: Client, row: Database["public"]["Tables"]["email_campaigns"]["Row"]): Promise<CampaignView> {
  const [stats, variants] = await Promise.all([campaignStats(client, row.id), variantStats(client, row.id)]);
  const ramp = rampFrom(row.ramp);
  return {
    id: row.id,
    name: row.name,
    status: row.status as CampaignView["status"],
    offerCents: row.offer_cents,
    codeExpiresOn: row.code_expires_on,
    serviceLabel: row.service_label,
    pricing: pricingFrom(row.pricing),
    ramp,
    pausedReason: row.paused_reason,
    startedAt: row.started_at,
    stats,
    variants,
    shares: variantShares(variants),
    todaysCap: todaysCap(ramp, stats.sendDays),
  };
}

/** Every campaign this business has, newest first, with its numbers. */
export async function listCampaigns(): Promise<CampaignView[]> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const { data, error } = await supabase
    .from("email_campaigns")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return Promise.all((data ?? []).map((row) => campaignView(supabase, row)));
}

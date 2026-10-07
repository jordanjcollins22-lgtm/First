import { createAdminClient } from "@/lib/supabase/admin";
import { env, isAnthropicConfigured } from "@/lib/env";
import { isColdMailboxSet, coldMailbox } from "@/lib/data/pm-sender";
import { DEFAULT_OFFER, DEFAULT_STORY } from "@/lib/pm-writer-prompt";
import { startOfToday } from "@/lib/data/post-board";

export interface PmEmailRow {
  id: string;
  step: number;
  subject: string;
  body: string;
  status: string;
  sendAfter: string | null;
  sentAt: string | null;
  error: string | null;
}

export interface PmCompanyRow {
  id: string;
  name: string;
  website: string | null;
  phone: string | null;
  address: string | null;
  contactName: string | null;
  email: string | null;
  status: string;
  note: string | null;
  lastError: string | null;
  repliedAt: string | null;
  lastReply: string | null;
  createdAt: string;
  emails: PmEmailRow[];
}

export interface PmSettingsView {
  sendingOn: boolean;
  autoApprove: boolean;
  dailyCap: number;
  fromName: string;
  story: string;
  offer: string;
  towns: string[];
  lastSearchAt: string | null;
}

export interface PmSetupCheck {
  key: "address" | "places" | "mailbox" | "writer" | "sending";
  done: boolean;
  label: string;
  how: string;
}

export interface PmBoard {
  settings: PmSettingsView;
  checks: PmSetupCheck[];
  counts: Record<string, number>;
  sentToday: number;
  companies: PmCompanyRow[];
  mailboxFrom: string | null;
}

/**
 * Everything the Property managers page shows: the settings (made on first
 * open, with the owner's story and the offer filled in), what is still
 * needed before anything can go out, the funnel, and every company with its
 * emails.
 */
export async function getPmBoard(organizationId: string): Promise<PmBoard> {
  const admin = createAdminClient();
  let { data: settings } = await admin.from("pm_outreach_settings").select("*").eq("organization_id", organizationId).maybeSingle();
  if (!settings) {
    const { data: made } = await admin
      .from("pm_outreach_settings")
      .upsert({ organization_id: organizationId, story: DEFAULT_STORY, offer: DEFAULT_OFFER, from_name: "Jordan Collins" }, { onConflict: "organization_id" })
      .select("*")
      .single();
    settings = made;
  }

  const [{ data: org }, { data: companies }, { count: sentToday }] = await Promise.all([
    admin.from("organizations").select("business_address").eq("id", organizationId).maybeSingle(),
    admin
      .from("pm_companies")
      .select("id, name, website, phone, address, contact_name, email, status, note, last_error, replied_at, last_reply, created_at, emails:pm_emails(id, step, subject, body, status, send_after, sent_at, error)")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .limit(300),
    admin.from("pm_emails").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "sent").gte("sent_at", startOfToday(new Date()).toISOString()),
  ]);

  const rows: PmCompanyRow[] = (companies ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    website: c.website,
    phone: c.phone,
    address: c.address,
    contactName: c.contact_name,
    email: c.email,
    status: c.status,
    note: c.note,
    lastError: c.last_error,
    repliedAt: c.replied_at,
    lastReply: c.last_reply,
    createdAt: c.created_at,
    emails: ((c.emails ?? []) as { id: string; step: number; subject: string; body: string; status: string; send_after: string | null; sent_at: string | null; error: string | null }[])
      .map((e) => ({ id: e.id, step: e.step, subject: e.subject, body: e.body, status: e.status, sendAfter: e.send_after, sentAt: e.sent_at, error: e.error }))
      .sort((a, b) => a.step - b.step),
  }));

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const s = settings;
  const view: PmSettingsView = {
    sendingOn: s?.sending_on ?? false,
    autoApprove: s?.auto_approve ?? false,
    dailyCap: s?.daily_cap ?? 20,
    fromName: s?.from_name ?? "",
    story: s?.story || DEFAULT_STORY,
    offer: s?.offer || DEFAULT_OFFER,
    towns: s?.towns ?? [],
    lastSearchAt: s?.last_search_at ?? null,
  };

  const checks: PmSetupCheck[] = [
    { key: "address", done: Boolean(org?.business_address?.trim()), label: "Business street address", how: "Settings → Business. The law asks for a postal address at the bottom of every cold email." },
    { key: "places", done: Boolean(env.googlePlacesApiKey), label: "Google Places key", how: "GOOGLE_PLACES_API_KEY in Vercel. This is how it finds property management companies in each town." },
    { key: "mailbox", done: isColdMailboxSet, label: "Cold email mailbox", how: "A separate domain and mailbox just for cold email, with COLD_SMTP_HOST, COLD_SMTP_USER, COLD_SMTP_PASS and COLD_FROM_EMAIL in Vercel." },
    { key: "writer", done: isAnthropicConfigured, label: "Email writer", how: "ANTHROPIC_API_KEY in Vercel." },
    { key: "sending", done: view.sendingOn, label: "Sending switched on", how: "The switch below. Nothing goes out until you turn it on." },
  ];

  return { settings: view, checks, counts, sentToday: sentToday ?? 0, companies: rows, mailboxFrom: isColdMailboxSet ? coldMailbox.from : null };
}

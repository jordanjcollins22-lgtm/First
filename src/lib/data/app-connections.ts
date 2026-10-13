import type { SupabaseClient } from "@supabase/supabase-js";

import { env, isPlaidLive } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The services the app was already wired to before the Integrations page:
 * keys that live in the server's environment (Vercel) or in their own
 * settings screens. Read-only here. Each says whether it is set and how to
 * fix it if not, and never shows a value — only which variables are present.
 */

export interface AppConnectionCheck {
  /** The env var or setting, by name. */
  name: string;
  present: boolean;
  /** Optional ones don't make the whole connection "missing". */
  optional?: boolean;
}

export interface AppConnection {
  id: string;
  name: string;
  area: "Marketing" | "Sales" | "Operations" | "Admin";
  what: string;
  where: "Vercel environment" | "In-app settings" | "Vercel environment + in-app settings";
  status: "configured" | "partial" | "missing";
  checks: AppConnectionCheck[];
  /** One line of extra state ("2 pages connected", "Sandbox bank"). */
  detail?: string;
  fix: string[];
  settingsHref?: string;
}

const has = (v: string | undefined | null) => Boolean(v && v.trim());

function statusOf(checks: AppConnectionCheck[]): AppConnection["status"] {
  const required = checks.filter((c) => !c.optional);
  const got = required.filter((c) => c.present).length;
  if (got === required.length) return "configured";
  return got === 0 ? "missing" : "partial";
}

const VERCEL_FIX = "In Vercel: Project → Settings → Environment Variables, add it for Production, then redeploy.";

export async function listAppConnections(organizationId: string): Promise<AppConnection[]> {
  const db = createAdminClient() as unknown as SupabaseClient;
  const [{ data: meta }, { count: metaPages }, { count: domains }, { count: bankLinks }, { count: indeed }] = await Promise.all([
    db.from("meta_settings").select("app_id, app_secret, connected_at").eq("organization_id", organizationId).maybeSingle(),
    db.from("meta_pages").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    db.from("email_domains").select("id", { count: "exact", head: true }).eq("organization_id", organizationId).eq("status", "verified"),
    db.from("bank_links").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
    db.from("indeed_invites").select("id", { count: "exact", head: true }).eq("organization_id", organizationId),
  ]);
  const m = meta as { app_id: string | null; app_secret: string | null; connected_at: string | null } | null;

  const list: Omit<AppConnection, "status">[] = [
    {
      id: "stripe",
      name: "Stripe",
      area: "Admin",
      what: "Invoices, card and bank payments, deposits, subscriptions, autopay.",
      where: "Vercel environment",
      checks: [
        { name: "STRIPE_SECRET_KEY", present: has(env.stripeSecretKey) },
        { name: "STRIPE_WEBHOOK_SECRET", present: has(env.stripeWebhookSecret) },
        { name: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", present: has(env.stripePublishableKey), optional: true },
      ],
      detail: env.stripeSecretKey.startsWith("sk_test") ? "Test mode key — no real money moves." : undefined,
      fix: [
        "Stripe dashboard → Developers → API keys: copy the Secret key (sk_live_…) and Publishable key (pk_live_…).",
        "Developers → Webhooks → Add endpoint: <your app>/api/webhooks/stripe with invoice.paid, invoice.payment_succeeded, invoice.voided, invoice.marked_uncollectible, checkout.session.completed, customer.subscription.deleted. Copy its signing secret (whsec_…).",
        "Settings → Payments → Payment methods: switch on ACH Direct Debit so invoices can offer bank payment.",
        VERCEL_FIX,
      ],
    },
    {
      id: "twilio",
      name: "Twilio",
      area: "Sales",
      what: "Texts to clients and team: reminders, on-my-way, alerts.",
      where: "Vercel environment",
      checks: [
        { name: "TWILIO_ACCOUNT_SID", present: has(env.twilioAccountSid) },
        { name: "TWILIO_AUTH_TOKEN", present: has(env.twilioAuthToken) },
        { name: "TWILIO_PHONE_NUMBER", present: has(env.twilioPhoneNumber) },
      ],
      fix: [
        "console.twilio.com → Account info: copy the Account SID and Auth token.",
        "Phone Numbers → Active numbers: copy the number in +1XXXXXXXXXX form. It must be registered for A2P 10DLC (Messaging → Regulatory compliance) or carriers block the texts.",
        VERCEL_FIX,
      ],
    },
    {
      id: "resend",
      name: "Resend (email)",
      area: "Admin",
      what: "Every email the app sends: invoices, reminders, campaigns.",
      where: "Vercel environment + in-app settings",
      checks: [
        { name: "RESEND_API_KEY", present: has(env.resendApiKey) },
        { name: "Verified sending domain (Settings → Email)", present: (domains ?? 0) > 0 },
        { name: "RESEND_WEBHOOK_SECRET", present: has(env.resendWebhookSecret), optional: true },
      ],
      fix: [
        "resend.com → API Keys → Create (Full access). Add it as RESEND_API_KEY.",
        "In the app: Settings → Email, add the sending domain and put the DNS records it shows at your domain host.",
        "Optional: Resend → Webhooks → add <your app>/api/webhooks/resend for bounces; its secret is RESEND_WEBHOOK_SECRET.",
        VERCEL_FIX,
      ],
    },
    {
      id: "gohighlevel",
      name: "GoHighLevel",
      area: "Sales",
      what: "Mirrors evaluations onto the GHL calendar and reads GHL bookings.",
      where: "Vercel environment",
      checks: [
        { name: "GHL_API_KEY", present: has(env.ghlApiKey) },
        { name: "GHL_LOCATION_ID", present: has(env.ghlLocationId) },
        { name: "GHL_CALENDAR_ID", present: has(env.ghlCalendarId) },
      ],
      detail: env.ghlTextsEnabled ? "Texts through GHL are on (GHL_TEXTS_ENABLED)." : undefined,
      fix: [
        "In the GHL sub-account: Settings → Private Integrations → Create, with calendars and contacts scopes. Copy the token as GHL_API_KEY.",
        "Settings → Business Profile shows the Location ID. Calendars → the evaluation calendar's settings show its ID.",
        VERCEL_FIX,
      ],
    },
    {
      id: "gmail",
      name: "Gmail",
      area: "Sales",
      what: "Sends evaluation emails from the office Gmail when no Resend domain is ready.",
      where: "Vercel environment",
      checks: [
        { name: "GMAIL_USER", present: has(env.gmailUser) },
        { name: "GMAIL_APP_PASSWORD", present: has(env.gmailAppPassword) },
      ],
      fix: [
        "Turn on 2-Step Verification for the Google account, then myaccount.google.com → Security → App passwords → create one for \"Mail\".",
        "GMAIL_USER is the address; GMAIL_APP_PASSWORD the 16-letter password.",
        VERCEL_FIX,
      ],
    },
    {
      id: "meta",
      name: "Meta (Facebook & Instagram)",
      area: "Marketing",
      what: "Posts to the Facebook page, and its Messenger and Instagram inbox.",
      where: "In-app settings",
      checks: [
        { name: "Meta app ID and secret (Admin → Facebook & Instagram)", present: Boolean(m?.app_id && m?.app_secret) },
        { name: "At least one page connected", present: (metaPages ?? 0) > 0 },
      ],
      detail: `${metaPages ?? 0} page${metaPages === 1 ? "" : "s"} connected`,
      fix: ["Open Admin → Facebook & Instagram → Setup and follow the steps there, then press Connect Facebook."],
      settingsHref: "/admin/meta",
    },
    {
      id: "plaid",
      name: "Plaid (bank)",
      area: "Admin",
      what: "Bank balances and transactions: cash on hand, spend, overhead.",
      where: "Vercel environment + in-app settings",
      checks: [
        { name: "PLAID_CLIENT_ID", present: has(env.plaidClientId) },
        { name: "PLAID_SECRET", present: has(env.plaidSecret) },
        { name: "PLAID_ENV=production", present: isPlaidLive },
        { name: "A bank linked (Finance → Transactions)", present: (bankLinks ?? 0) > 0 },
      ],
      detail: isPlaidLive ? undefined : "Sandbox: balances are Plaid's pretend bank.",
      fix: [
        "dashboard.plaid.com → Developers → Keys: copy the client_id and the Production secret.",
        "Set PLAID_ENV=production. " + VERCEL_FIX,
        "Then in the app: Finance → Transactions → Link bank.",
      ],
      settingsHref: "/admin/transactions",
    },
    {
      id: "rentcast",
      name: "RentCast",
      area: "Sales",
      what: "Property facts (size, year built) for a new address.",
      where: "Vercel environment",
      checks: [{ name: "RENTCAST_API_KEY", present: has(env.rentcastApiKey) }],
      fix: ["app.rentcast.io → API → create an API key.", VERCEL_FIX],
    },
    {
      id: "mapbox",
      name: "Mapbox",
      area: "Operations",
      what: "Every map: zones, routes, the site map, door-hanger walks.",
      where: "Vercel environment",
      checks: [{ name: "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN", present: has(env.mapboxToken) }],
      fix: ["account.mapbox.com → Access tokens → copy the default public token (pk.…). Restrict it to your app's URL.", VERCEL_FIX],
    },
    {
      id: "anthropic",
      name: "Anthropic (Claude)",
      area: "Admin",
      what: "The admin assistant, scope drafting, suggested replies and captions.",
      where: "Vercel environment",
      checks: [{ name: "ANTHROPIC_API_KEY", present: has(env.anthropicApiKey) }],
      fix: ["console.anthropic.com → API Keys → Create key. Add billing under Plans & billing.", VERCEL_FIX],
    },
    {
      id: "indeed",
      name: "Indeed",
      area: "Admin",
      what: "Applicants from Indeed get the app's application link automatically.",
      where: "In-app settings",
      checks: [
        { name: "RESEND_API_KEY (reads the forwarded mail)", present: has(env.resendApiKey) },
        { name: "Indeed applications arriving", present: (indeed ?? 0) > 0, optional: true },
      ],
      detail: (indeed ?? 0) > 0 ? `${indeed} applicant${indeed === 1 ? "" : "s"} handled so far` : "No Indeed applications seen yet.",
      fix: [
        "In Indeed's employer account: Settings → Communication → add hiring@send.jslandscapingmd.com as the address application emails go to.",
        "Nothing to paste: the app answers each one from that inbox.",
      ],
    },
  ];
  return list.map((c) => ({ ...c, status: statusOf(c.checks) }));
}

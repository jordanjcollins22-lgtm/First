import type Stripe from "stripe";

import { contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";
import { financeDb, getFinanceSettings } from "@/lib/data/finance-settings";
import { isStripeConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient, stripeCustomerFor } from "@/lib/stripe-customer";

/**
 * Autopay: a recurring client saves a card or, better, their bank once, and
 * each invoice after that is paid from it without anybody chasing.
 *
 * 1. The owner (or the default) puts a client on autopay and the app makes a
 *    Stripe setup page for them: card, and US bank when ACH is offered.
 * 2. When they finish it, the saved method becomes their Stripe default
 *    (reconcileAutopay, every run).
 * 3. Each open invoice raised for them after both autopay was switched on
 *    and their method was saved is charged once (chargeAutopayInvoices).
 *    autopay_charges is claimed before Stripe is called, so two runs at
 *    once can never take the money twice. Nothing older is ever charged.
 */

export interface AutopayClient {
  customerId: string;
  name: string;
  email: string | null;
  recurring: boolean;
  enabled: boolean;
  confirmedAt: string | null;
  methodType: string | null;
  last4: string | null;
  setupUrl: string | null;
  setupRequestedAt: string | null;
  lastError: string | null;
}

/**
 * Recurring clients: a subscription plan that isn't cancelled, or two or more
 * invoices in the last six months. Plus anybody already put on autopay.
 */
export async function listAutopayClients(organizationId: string): Promise<AutopayClient[]> {
  const db = financeDb();
  const since = new Date(Date.now() - 183 * 86_400_000).toISOString();
  const [{ data: plans }, { data: invs }, { data: rows }] = await Promise.all([
    db.from("payment_plans").select("customer_id").eq("organization_id", organizationId).eq("kind", "subscription").neq("status", "cancelled"),
    db.from("invoices").select("jobs(properties(customer_id))").eq("organization_id", organizationId).neq("status", "void").gte("created_at", since),
    db.from("customer_autopay").select("*").eq("organization_id", organizationId),
  ]);
  const counts = new Map<string, number>();
  for (const r of (invs ?? []) as unknown as { jobs: { properties: { customer_id: string | null } | null } | null }[]) {
    const id = r.jobs?.properties?.customer_id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const recurring = new Set<string>([
    ...((plans ?? []) as { customer_id: string }[]).map((p) => p.customer_id),
    ...[...counts].filter(([, n]) => n >= 2).map(([id]) => id),
  ]);
  type Row = {
    customer_id: string;
    enabled: boolean;
    confirmed_at: string | null;
    payment_method_type: string | null;
    payment_method_last4: string | null;
    setup_url: string | null;
    setup_requested_at: string | null;
    last_error: string | null;
  };
  const byId = new Map(((rows ?? []) as Row[]).map((r) => [r.customer_id, r]));
  const ids = [...new Set([...recurring, ...byId.keys()])];
  if (!ids.length) return [];
  const { data: custs } = await db.from("customers").select("id, name, email").in("id", ids);
  return ((custs ?? []) as { id: string; name: string; email: string | null }[])
    .map((c) => {
      const r = byId.get(c.id);
      return {
        customerId: c.id,
        name: c.name,
        email: c.email,
        recurring: recurring.has(c.id),
        enabled: r?.enabled ?? false,
        confirmedAt: r?.confirmed_at ?? null,
        methodType: r?.payment_method_type ?? null,
        last4: r?.payment_method_last4 ?? null,
        setupUrl: r?.setup_url ?? null,
        setupRequestedAt: r?.setup_requested_at ?? null,
        lastError: r?.last_error ?? null,
      };
    })
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
}

/** Makes the client's "save your card or bank" page. Returns its address. */
export async function createAutopaySetup(organizationId: string, customerId: string, baseUrl: string): Promise<{ url: string } | { error: string }> {
  if (!isStripeConfigured) return { error: "Stripe is not connected — add STRIPE_SECRET_KEY to the server." };
  const settings = await getFinanceSettings(organizationId);
  const stripeCustomer = await stripeCustomerFor(customerId);
  if (!stripeCustomer) return { error: "Couldn't find or create that client in Stripe." };
  const stripe = stripeClient();
  const base = baseUrl.replace(/\/$/, "");
  const types: Stripe.Checkout.SessionCreateParams.PaymentMethodType[] = settings.offerAch ? ["us_bank_account", "card"] : ["card"];
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      customer: stripeCustomer,
      payment_method_types: types,
      success_url: `${base}/my?autopay=saved`,
      cancel_url: `${base}/my`,
      metadata: { purpose: "autopay", customer_id: customerId, organization_id: organizationId },
    });
  } catch (err) {
    // A Stripe account without ACH switched on refuses us_bank_account;
    // a card-only page is better than none.
    if (!settings.offerAch) throw err;
    session = await stripe.checkout.sessions.create({
      mode: "setup",
      currency: "usd",
      customer: stripeCustomer,
      payment_method_types: ["card"],
      success_url: `${base}/my?autopay=saved`,
      cancel_url: `${base}/my`,
      metadata: { purpose: "autopay", customer_id: customerId, organization_id: organizationId },
    });
  }
  if (!session.url) return { error: "Stripe didn't return a page." };
  await financeDb().from("customer_autopay").upsert({
    organization_id: organizationId,
    customer_id: customerId,
    enabled: true,
    stripe_customer_id: stripeCustomer,
    setup_session_id: session.id,
    setup_url: session.url,
    setup_requested_at: new Date().toISOString(),
    last_error: null,
    updated_at: new Date().toISOString(),
  });
  return { url: session.url };
}

/** Emails the client their setup link, through the one client-messaging door. */
export async function sendAutopaySetup(organizationId: string, customerId: string, url: string, sessionKey: string): Promise<{ ok: boolean; message: string }> {
  const admin = createAdminClient();
  const [{ data: org }, contacts] = await Promise.all([
    admin.from("organizations").select("name, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", organizationId).maybeSingle(),
    contactsFor([customerId]),
  ]);
  const contact = contacts.get(customerId);
  if (!contact) return { ok: false, message: "That client isn't there." };
  const business = org?.name ?? "JS Landscaping";
  const first = (contact.name ?? "").split(/\s+/)[0] || "there";
  const outcome = await sendClientMessage(
    {
      organizationId,
      customerId,
      channel: "email",
      basis: "service",
      kind: "autopay_setup",
      dedupeKey: `autopay_setup:${customerId}:${sessionKey}`,
      subject: `Set up automatic payments with ${business}`,
      body: [
        `Hi ${first},`,
        "",
        `To save you writing checks or paying each invoice by hand, you can put your account on automatic payment. Each invoice is paid on the day it's sent, and you'll still get a copy.`,
        "",
        `Paying from your bank account (ACH) is the option we recommend for regular service.`,
        "",
        `Set it up here (takes a minute): ${url}`,
        "",
        `Thank you,`,
        business,
      ].join("\n"),
      automatic: false,
    },
    contact,
    quietWindowFor(org ?? {})
  );
  return outcome.sent ? { ok: true, message: "Sent." } : { ok: false, message: outcome.detail || outcome.reason };
}

/** Makes each finished setup the client's default payment method in Stripe. */
export async function reconcileAutopay(organizationId: string): Promise<number> {
  if (!isStripeConfigured) return 0;
  const db = financeDb();
  const { data } = await db
    .from("customer_autopay")
    .select("customer_id, stripe_customer_id, setup_session_id")
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .is("confirmed_at", null)
    .not("setup_session_id", "is", null);
  const stripe = stripeClient();
  let confirmed = 0;
  for (const row of (data ?? []) as { customer_id: string; stripe_customer_id: string | null; setup_session_id: string }[]) {
    try {
      const session = await stripe.checkout.sessions.retrieve(row.setup_session_id, { expand: ["setup_intent.payment_method"] });
      if (session.status !== "complete") continue;
      const intent = session.setup_intent as Stripe.SetupIntent | null;
      const pm = intent?.payment_method as Stripe.PaymentMethod | null;
      if (!pm?.id || !row.stripe_customer_id) continue;
      await stripe.customers.update(row.stripe_customer_id, { invoice_settings: { default_payment_method: pm.id } });
      await db
        .from("customer_autopay")
        .update({
          confirmed_at: new Date().toISOString(),
          payment_method_type: pm.type,
          payment_method_last4: pm.us_bank_account?.last4 ?? pm.card?.last4 ?? null,
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", organizationId)
        .eq("customer_id", row.customer_id);
      confirmed++;
    } catch (err) {
      log.warn("autopay.reconcile.failed", { organizationId, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return confirmed;
}

/**
 * Charges each open invoice for a client on autopay, once. Only invoices
 * created after autopay was switched on for the business AND after this
 * client's method was saved: the backlog is never swept.
 */
export async function chargeAutopayInvoices(organizationId: string): Promise<{ charged: number; failed: number }> {
  const result = { charged: 0, failed: 0 };
  if (!isStripeConfigured) return result;
  const settings = await getFinanceSettings(organizationId);
  if (!settings.autopayEnabled || !settings.autopayStartedAt) return result;
  const db = financeDb();
  const { data: clients } = await db
    .from("customer_autopay")
    .select("customer_id, stripe_customer_id, confirmed_at")
    .eq("organization_id", organizationId)
    .eq("enabled", true)
    .not("confirmed_at", "is", null);
  const byStripe = new Map(
    ((clients ?? []) as { customer_id: string; stripe_customer_id: string | null; confirmed_at: string }[])
      .filter((c) => c.stripe_customer_id)
      .map((c) => [c.stripe_customer_id!, c])
  );
  if (!byStripe.size) return result;

  const { data: invs } = await db
    .from("invoices")
    .select("id, amount, stripe_invoice_id, stripe_customer_id, created_at")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .gte("created_at", settings.autopayStartedAt)
    .in("stripe_customer_id", [...byStripe.keys()])
    .not("stripe_invoice_id", "is", null);
  const stripe = stripeClient();
  for (const inv of (invs ?? []) as { id: string; amount: number; stripe_invoice_id: string; stripe_customer_id: string; created_at: string }[]) {
    const client = byStripe.get(inv.stripe_customer_id);
    if (!client || inv.created_at < client.confirmed_at) continue;
    // The claim: a second run, or a run racing this one, stops here.
    const { error: claimError } = await db.from("autopay_charges").insert({
      organization_id: organizationId,
      stripe_invoice_id: inv.stripe_invoice_id,
      customer_id: client.customer_id,
      invoice_id: inv.id,
      amount_cents: Math.round(Number(inv.amount) * 100),
    });
    if (claimError) continue;
    try {
      // Pays with the customer's default method; ACH settles in a few days and
      // the existing invoice.paid webhook marks it paid when it does.
      await stripe.invoices.pay(inv.stripe_invoice_id);
      await db.from("autopay_charges").update({ status: "paid" }).eq("organization_id", organizationId).eq("stripe_invoice_id", inv.stripe_invoice_id);
      result.charged++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Charge refused.";
      await db.from("autopay_charges").update({ status: "failed", error: message.slice(0, 500) }).eq("organization_id", organizationId).eq("stripe_invoice_id", inv.stripe_invoice_id);
      await db.from("customer_autopay").update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("organization_id", organizationId).eq("customer_id", client.customer_id);
      log.warn("autopay.charge.failed", { organizationId, message });
      result.failed++;
    }
  }
  return result;
}

/**
 * The payment settings new Stripe invoices are raised with: card and, when
 * the business offers it, US bank (ACH) at 0.8% capped at $5. Undefined
 * leaves Stripe's dashboard defaults alone.
 */
export async function invoicePaymentSettings(organizationId: string): Promise<Stripe.InvoiceCreateParams.PaymentSettings | undefined> {
  try {
    const settings = await getFinanceSettings(organizationId);
    if (!settings.ready || !settings.offerAch) return undefined;
    return {
      payment_method_types: ["card", "us_bank_account"],
      payment_method_options: { us_bank_account: { verification_method: "automatic" } },
    };
  } catch {
    return undefined;
  }
}

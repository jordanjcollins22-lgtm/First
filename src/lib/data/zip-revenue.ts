import { stripeClient } from "@/lib/stripe-customer";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, localDay } from "@/lib/finance/dates";

/** Revenue by ZIP code for the owner's "All locations" card: money that came in, by where the client lives. */

/** Harford County ZIP codes and the town each one is. We only work here, with rare exceptions. */
export const HARFORD_ZIPS: Record<string, string> = {
  "21001": "Aberdeen",
  "21005": "Aberdeen Proving Ground",
  "21009": "Abingdon",
  "21010": "Gunpowder",
  "21013": "Baldwin",
  "21014": "Bel Air",
  "21015": "Bel Air",
  "21017": "Belcamp",
  "21018": "Benson",
  "21028": "Churchville",
  "21034": "Darlington",
  "21040": "Edgewood",
  "21047": "Fallston",
  "21050": "Forest Hill",
  "21078": "Havre de Grace",
  "21084": "Jarrettsville",
  "21085": "Joppa",
  "21087": "Kingsville",
  "21130": "Perryman",
  "21132": "Pylesville",
  "21154": "Street",
  "21160": "Whiteford",
  "21161": "White Hall",
};

/** The ZIP code in an address: the last 5-digit Maryland code (21xxx), so a house number isn't taken for one. */
export function zipOf(address: string | null | undefined): string | null {
  const all = [...(address ?? "").matchAll(/\b(21\d{3})(?:-\d{4})?\b/g)];
  if (!all.length) return null;
  const last = all[all.length - 1];
  // "21015 Old Joppa Rd" with no ZIP after it: that's a house number, not a ZIP.
  return last.index === 0 ? null : last[1];
}

export const isFamily = (name: string | null | undefined) => /heffner/i.test(name ?? "");

export type RangeKey = "30d" | "month" | "ytd" | "custom";
export interface DayRange {
  key: RangeKey;
  from: string;
  to: string;
  label: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Last 30 days, this month (default), year to date, or a custom from/to, from the page's search params. */
export function pickRange(q: { range?: string; from?: string; to?: string }, now = new Date()): DayRange {
  const today = localDay(now);
  if (q.range === "30d") return { key: "30d", from: addDays(today, -29), to: today, label: "last 30 days" };
  if (q.range === "ytd") return { key: "ytd", from: `${today.slice(0, 4)}-01-01`, to: today, label: "year to date" };
  if (q.range === "custom") {
    let from = q.from && DAY.test(q.from) ? q.from : `${today.slice(0, 7)}-01`;
    let to = q.to && DAY.test(q.to) ? q.to : today;
    if (from > to) [from, to] = [to, from];
    return { key: "custom", from, to, label: `${nice(from)} to ${nice(to)}` };
  }
  return { key: "month", from: `${today.slice(0, 7)}-01`, to: today, label: "this month" };
}

export interface ZipRow {
  zip: string;
  town: string;
  /** Clients with a property in this ZIP (not counting family). */
  clients: number;
}

/** What was billed in the chosen days: the money, how many jobs it was for, and the average ticket. */
export interface Billed {
  amount: number;
  jobs: number;
  /** Clients who were billed. */
  payers: number;
  /** Revenue ÷ clients billed (Jordan's definition, 2026-11-16). 0 when nobody was billed. */
  avgTicket: number;
}

export interface ZipRevenue extends Billed {
  rows: (ZipRow & Billed)[];
  /** Paid from an address outside Harford County. */
  elsewhere: Billed;
  /** Checks, deposits and Zelle that reached the bank but aren't recorded against a client yet. */
  unmatched: number;
}

interface Tally {
  amount: number;
  jobs: Set<string>;
  payers: Set<string>;
}
const newTally = (): Tally => ({ amount: 0, jobs: new Set(), payers: new Set() });
const r2 = (n: number) => Math.round(n * 100) / 100;
export function billed(t: Tally | undefined): Billed {
  if (!t) return { amount: 0, jobs: 0, payers: 0, avgTicket: 0 };
  return { amount: r2(t.amount), jobs: t.jobs.size, payers: t.payers.size, avgTicket: t.payers.size ? r2(t.amount / t.payers.size) : 0 };
}

type Row = Record<string, unknown>;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** A bank credit that's a client paying: a check or cash deposit, or a Zelle. Not transfers, corrections or refunds. */
export function isClientDeposit(name: string): boolean {
  if (/stripe|xfer|transfer|correction|refund|interest|reversal/i.test(name)) return false;
  return /deposit|zelle/i.test(name);
}

/** Stripe card payments in the range: amount kept (less refunds), who paid, and the ZIP they gave. */
async function stripeCharges(fromTs: number, toTs: number) {
  const out: { pi: string; amount: number; email: string | null; customer: string | null; zip: string | null; day: string }[] = [];
  const stripe = stripeClient();
  for await (const c of stripe.charges.list({ created: { gte: fromTs, lt: toTs }, limit: 100 })) {
    if (c.status !== "succeeded" || !c.paid) continue;
    const kept = (c.amount_captured - c.amount_refunded) / 100;
    if (kept <= 0) continue;
    out.push({
      pi: typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id ?? c.id,
      amount: kept,
      email: (c.billing_details?.email || c.receipt_email || null)?.toLowerCase() ?? null,
      customer: typeof c.customer === "string" ? c.customer : c.customer?.id ?? null,
      zip: c.billing_details?.address?.postal_code?.slice(0, 5) ?? null,
      day: localDay(new Date(c.created * 1000)),
    });
  }
  return out;
}

/**
 * Money that came in during the chosen days, by the ZIP of the client who
 * paid. Card payments come from Stripe itself (the app's own records miss
 * some), checks and other payments from what the office recorded, and any
 * check or Zelle that reached the bank without a record shows as unmatched,
 * so the total matches the bank. Family (the Heffners) isn't counted.
 */
export async function loadZipRevenue(organizationId: string, range: DayRange): Promise<ZipRevenue> {
  const db = createAdminClient();
  // A day either side so time zones can't drop a payment; the exact day test is below.
  const fromTs = `${addDays(range.from, -1)}T00:00:00Z`;
  const toTs = `${addDays(range.to, 2)}T00:00:00Z`;
  const [{ data: props }, { data: pays }, { data: bank }, stripe] = await Promise.all([
    db.from("properties").select("customer_id, address, customers!inner(name, email, organization_id)").eq("customers.organization_id", organizationId),
    db
      .from("payments")
      .select("customer_id, job_id, amount_cents, surcharge_cents, received_at, stripe_payment_intent_id, payer_email")
      .eq("organization_id", organizationId)
      .gte("received_at", fromTs)
      .lt("received_at", toTs),
    db.from("bank_transactions").select("amount, posted_on, name, account_id").eq("organization_id", organizationId).lt("amount", 0).gte("posted_on", range.from).lte("posted_on", range.to),
    stripeCharges(Math.floor(Date.parse(fromTs) / 1000), Math.floor(Date.parse(toTs) / 1000)).catch(() => null),
  ]);

  // Where each client lives, and who is family.
  const clientsBy = new Map<string, Set<string>>();
  const zipOfCustomer = new Map<string, string>();
  const customerOfEmail = new Map<string, string>();
  const family = new Set<string>();
  for (const p of (props ?? []) as Row[]) {
    const c = one(p.customers as Row | Row[] | null);
    const id = String(p.customer_id);
    if (isFamily(c?.name as string)) {
      family.add(id);
      continue;
    }
    if (c?.email) customerOfEmail.set(String(c.email).toLowerCase(), id);
    const zip = zipOf(p.address as string);
    if (!zip) continue;
    if (!zipOfCustomer.has(id)) zipOfCustomer.set(id, zip);
    if (HARFORD_ZIPS[zip]) clientsBy.set(zip, (clientsBy.get(zip) ?? new Set()).add(id));
  }

  const byZip = new Map<string, Tally>();
  const elsewhere = newTally();
  const all = newTally();
  const add = (zip: string | null | undefined, amount: number, job: string, payer: string) => {
    if (!amount) return;
    const t = zip && HARFORD_ZIPS[zip] ? byZip.get(zip) ?? byZip.set(zip, newTally()).get(zip)! : elsewhere;
    for (const x of [t, all]) {
      x.amount += amount;
      x.jobs.add(job);
      x.payers.add(payer);
    }
  };
  const inRange = (day: string) => day >= range.from && day <= range.to;

  const payRows = ((pays ?? []) as Row[]).filter((p) => inRange(localDay(String(p.received_at))));
  const payByIntent = new Map(payRows.filter((p) => p.stripe_payment_intent_id).map((p) => [String(p.stripe_payment_intent_id), p]));

  // Card payments: Stripe's own list when it loads, else what the app recorded.
  if (stripe) {
    for (const c of stripe) {
      if (!inRange(c.day)) continue;
      const rec = payByIntent.get(c.pi);
      const customer = (rec?.customer_id as string | undefined) ?? (c.email ? customerOfEmail.get(c.email) : undefined);
      if (customer && family.has(customer)) continue;
      const zip = (customer && zipOfCustomer.get(customer)) || c.zip;
      const job = rec?.job_id ? `job:${rec.job_id}` : `card:${c.pi}`;
      add(zip, c.amount, job, customer ?? c.customer ?? c.email ?? c.pi);
    }
  }
  let recordedOffline = 0;
  for (const p of payRows) {
    const card = Boolean(p.stripe_payment_intent_id);
    if (card && stripe) continue;
    const customer = p.customer_id ? String(p.customer_id) : null;
    const amount = ((Number(p.amount_cents) || 0) - (Number(p.surcharge_cents) || 0)) / 100;
    if (!card) recordedOffline += (Number(p.amount_cents) || 0) / 100;
    if (customer && family.has(customer)) continue;
    add(customer ? zipOfCustomer.get(customer) : null, amount, p.job_id ? `job:${p.job_id}` : `pay:${customer}:${p.received_at}`, customer ?? String(p.payer_email ?? p.received_at));
  }

  // Checks and Zelle in the bank that nobody recorded in the app yet.
  const deposited = ((bank ?? []) as Row[]).filter((t) => isClientDeposit(String(t.name ?? ""))).reduce((s, t) => s - Number(t.amount), 0);
  const unmatched = r2(Math.max(0, deposited - recordedOffline));

  const zips = new Set([...clientsBy.keys(), ...byZip.keys()]);
  const rows = [...zips]
    .map((zip) => ({ zip, town: HARFORD_ZIPS[zip], clients: clientsBy.get(zip)?.size ?? 0, ...billed(byZip.get(zip)) }))
    .sort((a, b) => b.amount - a.amount || b.clients - a.clients || a.zip.localeCompare(b.zip));
  const total = billed(all);
  return { ...total, amount: r2(total.amount + unmatched), rows, elsewhere: billed(elsewhere), unmatched };
}

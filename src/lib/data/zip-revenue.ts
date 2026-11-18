import { createAdminClient } from "@/lib/supabase/admin";
import { addDays, localDay } from "@/lib/finance/dates";

/**
 * Revenue by ZIP code for the owner's "All locations" card. Counts what was
 * invoiced in the chosen days (job invoices by the day they were sent, client
 * invoices by the day they were issued), the same way the finance numbers
 * count "invoiced". Jordan's family (the Heffners) isn't client revenue.
 */

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

export type RangeKey = "month" | "90d" | "custom";
export interface DayRange {
  key: RangeKey;
  from: string;
  to: string;
  label: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const nice = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** This month (default), the last 90 days, or a custom from/to, from the page's search params. */
export function pickRange(q: { range?: string; from?: string; to?: string }, now = new Date()): DayRange {
  const today = localDay(now);
  if (q.range === "90d") return { key: "90d", from: addDays(today, -89), to: today, label: "last 90 days" };
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
  /** Billed to addresses outside Harford County, or with no ZIP on file. */
  elsewhere: Billed;
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

export async function loadZipRevenue(organizationId: string, range: DayRange): Promise<ZipRevenue> {
  const db = createAdminClient();
  // A little either side of the range so time zones can't drop an invoice; the exact day test is below.
  const fromTs = `${addDays(range.from, -1)}T00:00:00Z`;
  const toTs = `${addDays(range.to, 2)}T00:00:00Z`;
  const [{ data: props }, { data: invs }, { data: cinvs }] = await Promise.all([
    db.from("properties").select("customer_id, address, customers!inner(name, organization_id)").eq("customers.organization_id", organizationId),
    db
      .from("invoices")
      .select("job_id, amount, sent_at, created_at, jobs(properties(address, customer_id, customers(name)))")
      .eq("organization_id", organizationId)
      .neq("status", "void")
      .or(`and(sent_at.gte.${fromTs},sent_at.lt.${toTs}),and(sent_at.is.null,created_at.gte.${fromTs},created_at.lt.${toTs})`),
    db
      .from("client_invoices")
      .select("id, amount, issued_on, customer_id, customers(name)")
      .eq("organization_id", organizationId)
      .gte("issued_on", range.from)
      .lte("issued_on", range.to),
  ]);

  const clientsBy = new Map<string, Set<string>>();
  const zipOfCustomer = new Map<string, string>();
  for (const p of (props ?? []) as Row[]) {
    const c = one(p.customers as Row | Row[] | null);
    if (isFamily(c?.name as string)) continue;
    const zip = zipOf(p.address as string);
    if (!zip || !HARFORD_ZIPS[zip]) continue;
    const id = String(p.customer_id);
    if (!zipOfCustomer.has(id)) zipOfCustomer.set(id, zip);
    clientsBy.set(zip, (clientsBy.get(zip) ?? new Set()).add(id));
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

  for (const i of (invs ?? []) as Row[]) {
    const day = localDay(String(i.sent_at ?? i.created_at));
    if (day < range.from || day > range.to) continue;
    const prop = one(one(i.jobs as Row | Row[] | null)?.properties as Row | Row[] | null);
    if (isFamily(one(prop?.customers as Row | Row[] | null)?.name as string)) continue;
    add(zipOf(prop?.address as string), Number(i.amount) || 0, `job:${i.job_id}`, String(prop?.customer_id ?? `job:${i.job_id}`));
  }
  // A client invoice isn't tied to a job, so each one counts as its own job.
  for (const c of (cinvs ?? []) as Row[]) {
    if (isFamily(one(c.customers as Row | Row[] | null)?.name as string)) continue;
    add(zipOfCustomer.get(String(c.customer_id)), Number(c.amount) || 0, `ci:${c.id}`, String(c.customer_id));
  }

  const zips = new Set([...clientsBy.keys(), ...byZip.keys()]);
  const rows = [...zips]
    .map((zip) => ({ zip, town: HARFORD_ZIPS[zip], clients: clientsBy.get(zip)?.size ?? 0, ...billed(byZip.get(zip)) }))
    .sort((a, b) => b.amount - a.amount || b.clients - a.clients || a.zip.localeCompare(b.zip));
  return { ...billed(all), rows, elsewhere: billed(elsewhere) };
}

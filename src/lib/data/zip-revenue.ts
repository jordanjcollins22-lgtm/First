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
  amount: number;
  /** Clients with a property in this ZIP (not counting family). */
  clients: number;
}

export interface ZipRevenue {
  total: number;
  rows: ZipRow[];
  /** Billed to addresses outside Harford County, or with no ZIP on file. */
  elsewhere: number;
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
      .select("amount, sent_at, created_at, jobs(properties(address, customers(name)))")
      .eq("organization_id", organizationId)
      .neq("status", "void")
      .or(`and(sent_at.gte.${fromTs},sent_at.lt.${toTs}),and(sent_at.is.null,created_at.gte.${fromTs},created_at.lt.${toTs})`),
    db
      .from("client_invoices")
      .select("amount, issued_on, customer_id, customers(name)")
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

  const amountBy = new Map<string, number>();
  let elsewhere = 0;
  const add = (zip: string | null | undefined, amount: number) => {
    if (!amount) return;
    if (zip && HARFORD_ZIPS[zip]) amountBy.set(zip, (amountBy.get(zip) ?? 0) + amount);
    else elsewhere += amount;
  };

  for (const i of (invs ?? []) as Row[]) {
    const day = localDay(String(i.sent_at ?? i.created_at));
    if (day < range.from || day > range.to) continue;
    const prop = one(one(i.jobs as Row | Row[] | null)?.properties as Row | Row[] | null);
    if (isFamily(one(prop?.customers as Row | Row[] | null)?.name as string)) continue;
    add(zipOf(prop?.address as string), Number(i.amount) || 0);
  }
  for (const c of (cinvs ?? []) as Row[]) {
    if (isFamily(one(c.customers as Row | Row[] | null)?.name as string)) continue;
    add(zipOfCustomer.get(String(c.customer_id)), Number(c.amount) || 0);
  }

  const zips = new Set([...clientsBy.keys(), ...amountBy.keys()]);
  const rows = [...zips]
    .map((zip) => ({ zip, town: HARFORD_ZIPS[zip], amount: Math.round((amountBy.get(zip) ?? 0) * 100) / 100, clients: clientsBy.get(zip)?.size ?? 0 }))
    .sort((a, b) => b.amount - a.amount || b.clients - a.clients || a.zip.localeCompare(b.zip));
  const total = Math.round((rows.reduce((s, r) => s + r.amount, 0) + elsewhere) * 100) / 100;
  return { total, rows, elsewhere: Math.round(elsewhere * 100) / 100 };
}

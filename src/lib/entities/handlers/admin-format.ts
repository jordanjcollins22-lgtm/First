/**
 * The pure parts of the Admin page's drawer: how money and dates read, which
 * actions an invoice offers in which state, what "change role" adds and takes
 * away, and how a back-office key or an old-app link points at a thing the
 * drawer can open. No reads, no writes, so each rule is tested on its own.
 */
import { CANONICAL, type RoleKey } from "@/lib/roles";
import type { EntityRef } from "@/lib/entities/types";

const TZ = "America/New_York";

/** "$1,234" from dollars; a dash for nothing. */
export function usd(dollars: number | null | undefined): string {
  if (dollars == null || !Number.isFinite(dollars)) return "—";
  return (dollars < 0 ? "-$" : "$") + Math.abs(Math.round(dollars)).toLocaleString("en-US");
}

/** "$1,234.50" from dollars, for amounts somebody reconciles to the cent. */
export function usdExact(dollars: number | null | undefined): string {
  if (dollars == null || !Number.isFinite(dollars)) return "—";
  return (dollars < 0 ? "-$" : "$") + Math.abs(dollars).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "Mar 4, 2026" from a date or a timestamp; a dash for nothing. */
export function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  // A bare date is a calendar day, not midnight UTC the evening before.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });
}

/** "snake_case words" → "Snake case words". */
export function words(value: string | null | undefined): string {
  const s = (value ?? "").replace(/[_-]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "—";
}

export function isIsoDate(value: string | undefined | null): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

/** Dollars typed by a person ("$1,200.50") as cents, or null. */
export function dollarsToCents(value: string | undefined | null): number | null {
  const text = (value ?? "").replace(/[^0-9.]/g, "");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

/** "price:abc" → ["price", "abc"]; the rest may itself hold colons. */
export function splitRef(id: string): [string, string] {
  const at = id.indexOf(":");
  return at < 0 ? [id, ""] : [id.slice(0, at), id.slice(at + 1)];
}

/* ------------------------------------------------------------------ */
/* Alerts on the Departments part                                       */
/* ------------------------------------------------------------------ */

export const ALERT_KEYS = ["approvals", "stale_evals", "stale_days", "late_posts", "low_materials", "failing_fleet", "open_issues"] as const;
export type AlertKey = (typeof ALERT_KEYS)[number];

export function isAlertKey(value: string): value is AlertKey {
  return (ALERT_KEYS as readonly string[]).includes(value);
}

/** The words of one alert, given how many things are in it. Empty when there are none. */
export function alertLine(key: AlertKey, count: number, amount?: number): string {
  if (!count) return "";
  switch (key) {
    case "approvals":
      return `${count} proposals need your approval (${usd(amount ?? 0)})`;
    case "stale_evals":
      return `${count} evaluations past date still “scheduled”`;
    case "stale_days":
      return `${count} work days past date still “scheduled”`;
    case "late_posts":
      return `${count} social posts past date, never posted`;
    case "low_materials":
      return `${count} materials below reorder`;
    case "failing_fleet":
      return `${count} vehicles/trailers marked failing`;
    case "open_issues":
      return `${count} open job issues`;
  }
}

/** What the alert is called on its own, as the drawer's title. */
export const ALERT_TITLE: Record<AlertKey, string> = {
  approvals: "Proposals waiting for your approval",
  stale_evals: "Evaluations past their date",
  stale_days: "Work days past their date",
  late_posts: "Social posts never posted",
  low_materials: "Materials below reorder",
  failing_fleet: "Vehicles and trailers failing",
  open_issues: "Open job issues",
};

/* ------------------------------------------------------------------ */
/* Where things point                                                   */
/* ------------------------------------------------------------------ */

/** The job an old-app link names ("/jobs/<id>"), or null. */
export function jobIdFromHref(href: string | null | undefined): string | null {
  const m = /^\/jobs\/([0-9a-f-]{8,})/i.exec(href ?? "");
  return m ? m[1] : null;
}

/**
 * The thing a back-office key names, as the drawer opens it: a payout
 * batch, an obligation, a new-hire item or a person. Keys are written by
 * lib/data/back-office-queue.ts.
 */
export function backOfficeRef(key: string): EntityRef | null {
  const [kind, rest] = splitRef(key);
  const id = rest.split(":")[0];
  if (!id) return null;
  switch (kind) {
    case "commission_batch":
      return { kind: "admin.commission_batch", id };
    case "compliance":
      return { kind: "admin.obligation", id };
    case "onboarding":
      return { kind: "admin.onboarding_item", id };
    case "affiliate_rate":
    case "role":
      return { kind: "admin.profile", id };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Invoices                                                             */
/* ------------------------------------------------------------------ */

/** A bill raised through Stripe from a job, or one uploaded from the old books. */
export type InvoiceSource = "stripe" | "upload";

export interface InvoiceState {
  source: InvoiceSource;
  /** Stripe: open, paid, void. Upload: paid or open from paid_on. */
  status: string;
  hasLink: boolean;
}

/** Which of resend, mark paid and void an invoice offers in the state it is in. */
export function invoiceActionIds(s: InvoiceState): string[] {
  const open = s.status === "open";
  if (s.source === "stripe") {
    if (!open) return [];
    return [...(s.hasLink ? ["resend_sms", "resend_email"] : []), "paid_cash", "paid_check", "void"];
  }
  return open ? ["paid_cash", "paid_check", "delete"] : ["unpaid", "delete"];
}

/* ------------------------------------------------------------------ */
/* Roles                                                                */
/* ------------------------------------------------------------------ */

const norm = (r: string) => r.toLowerCase().replace(/[_\s]+/g, " ").trim();

/**
 * Changing somebody to one of the five roles: add its name, take away every
 * other role they hold. Owner-level keeps both of its names.
 */
export function roleChange(current: readonly string[], key: RoleKey): { add: string[]; remove: string[] } {
  const keep = CANONICAL[key];
  const add = keep.slice(0, 1).filter((name) => !current.some((r) => norm(r) === name));
  const remove = current.filter((r) => !keep.includes(norm(r)));
  return { add, remove };
}

/* ------------------------------------------------------------------ */
/* Job issues                                                           */
/* ------------------------------------------------------------------ */

/**
 * Closing an issue takes two answers, what was done and what changes so it
 * can't happen again, from one box: the first line, then the rest.
 */
export function splitResolution(text: string | undefined | null): { resolution: string; prevention: string } {
  const lines = (text ?? "").split(/\r?\n/);
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return { resolution: "", prevention: "" };
  return { resolution: lines[first].trim(), prevention: lines.slice(first + 1).join("\n").trim() };
}

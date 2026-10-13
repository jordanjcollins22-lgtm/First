import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { createAdminClient } from "@/lib/supabase/admin";
import { log } from "@/lib/log";
import { latin1, wrapText } from "@/lib/print-text";
import {
  INSURANCE_KINDS,
  KIND_LABEL,
  isRegisteredVehicle,
  marylandDefaults,
  obligationState,
  reminderDue,
  reminderText,
  type ObligationKind,
  type ObligationState,
  type Recurrence,
} from "@/lib/compliance/calendar";
import { afterStart, type BackOfficeSettings } from "@/lib/data/back-office-settings";
import { tellOwner } from "@/lib/data/back-office-owners";

/**
 * The compliance calendar's storage: obligations, the documents behind them,
 * and certificates of insurance for clients.
 *
 * Read with the service role after the caller has been checked, because the
 * cron and the fertilizer guard run with nobody signed in.
 */

type Admin = SupabaseClient;
const admin = (): Admin => createAdminClient() as unknown as Admin;

export const COMPLIANCE_BUCKET = "compliance-docs";

export interface Obligation {
  id: string;
  kind: ObligationKind | string;
  title: string;
  holder: string | null;
  dueOn: string | null;
  recurrence: Recurrence;
  dateConfirmed: boolean;
  active: boolean;
  creditsRequired: number | null;
  creditsEarned: number | null;
  carrier: string | null;
  policyNumber: string | null;
  coverageLimits: string | null;
  documentPath: string | null;
  notes: string | null;
  sourceUrl: string | null;
  lastDoneOn: string | null;
  createdAt: string;
  updatedAt: string;
  state: ObligationState;
}

/** Today in the business's time zone, as YYYY-MM-DD. */
export function businessToday(now = new Date(), timeZone = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function toObligation(row: Record<string, unknown>, today: string, reminderDays: number[]): Obligation {
  const o = {
    id: row.id as string,
    kind: row.kind as string,
    title: row.title as string,
    holder: (row.holder as string | null) ?? null,
    dueOn: (row.due_on as string | null) ?? null,
    recurrence: (row.recurrence as Recurrence) ?? "annual",
    dateConfirmed: Boolean(row.date_confirmed),
    active: Boolean(row.active),
    creditsRequired: row.credits_required == null ? null : Number(row.credits_required),
    creditsEarned: row.credits_earned == null ? null : Number(row.credits_earned),
    carrier: (row.carrier as string | null) ?? null,
    policyNumber: (row.policy_number as string | null) ?? null,
    coverageLimits: (row.coverage_limits as string | null) ?? null,
    documentPath: (row.document_path as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    sourceUrl: (row.source_url as string | null) ?? null,
    lastDoneOn: (row.last_done_on as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
  return { ...o, state: obligationState(o, today, reminderDays) };
}

/** Every obligation, soonest first, then the undated, then the inactive. */
export async function listObligations(organizationId: string, reminderDays: number[], now = new Date()): Promise<{ obligations: Obligation[]; ready: boolean }> {
  const { data, error } = await admin().from("compliance_obligations").select("*").eq("organization_id", organizationId);
  if (error) return { obligations: [], ready: false };
  const today = businessToday(now);
  const rank: Record<ObligationState, number> = { overdue: 0, due_soon: 1, no_date: 2, upcoming: 3, ok: 4, inactive: 5 };
  const obligations = ((data ?? []) as Record<string, unknown>[])
    .map((r) => toObligation(r, today, reminderDays))
    .sort((a, b) => rank[a.state] - rank[b.state] || (a.dueOn ?? "9999").localeCompare(b.dueOn ?? "9999") || a.title.localeCompare(b.title));
  return { obligations, ready: true };
}

/**
 * Put the Maryland defaults on a calendar. Safe to run again: each seed has
 * a key, so a second run adds only what is missing (a truck bought since).
 */
export async function seedMarylandDefaults(organizationId: string, now = new Date()): Promise<number> {
  const sb = admin();
  const today = businessToday(now);
  const rows: Record<string, unknown>[] = marylandDefaults(today).map((s) => ({
    organization_id: organizationId,
    seed_key: s.seedKey,
    kind: s.kind,
    title: s.title,
    due_on: s.dueOn,
    recurrence: s.recurrence,
    active: s.active,
    credits_required: s.creditsRequired ?? null,
    credits_earned: s.creditsRequired != null ? 0 : null,
    notes: s.notes,
    source_url: s.sourceUrl ?? null,
    date_confirmed: false,
  }));

  // One registration per vehicle in the fleet; a generic one when there is no fleet.
  const { data: fleet } = await sb.from("fleet_assets").select("id, name, kind, retired_on").eq("organization_id", organizationId).is("retired_on", null);
  const vehicles = ((fleet ?? []) as { id: string; name: string; kind: string | null }[]).filter((f) => isRegisteredVehicle(f.kind));
  if (vehicles.length === 0) {
    rows.push({
      organization_id: organizationId,
      seed_key: "vehicle_registration",
      kind: "vehicle_registration",
      title: "Vehicle registrations (MVA)",
      due_on: null,
      recurrence: "annual",
      active: true,
      notes: "Add one per truck and trailer, with the date on its registration card.",
      date_confirmed: false,
    });
  }
  for (const v of vehicles) {
    rows.push({
      organization_id: organizationId,
      seed_key: `vehicle_registration:${v.id}`,
      kind: "vehicle_registration",
      title: `Registration: ${v.name}`,
      holder: v.name,
      fleet_asset_id: v.id,
      due_on: null,
      recurrence: "annual",
      active: true,
      notes: "Enter the expiry date from the registration card.",
      date_confirmed: false,
    });
  }

  const { data, error } = await sb
    .from("compliance_obligations")
    .upsert(rows, { onConflict: "organization_id,seed_key", ignoreDuplicates: true })
    .select("id");
  if (error) {
    log.error("compliance.seed_failed", error, { organizationId });
    return 0;
  }
  return (data ?? []).length;
}

/**
 * Whether the business holds a current fertilizer applicator certification:
 * the thing that lets it apply (to 0.5 lb N) between Nov 16 and Dec 1.
 */
export async function certifiedFertilizerOnFile(organizationId: string, now = new Date()): Promise<boolean> {
  const { data } = await admin()
    .from("compliance_obligations")
    .select("due_on, active")
    .eq("organization_id", organizationId)
    .eq("kind", "fertilizer_applicator")
    .eq("active", true);
  const today = businessToday(now);
  return ((data ?? []) as { due_on: string | null }[]).some((r) => r.due_on != null && r.due_on >= today);
}

/**
 * The daily reminders: 60, 30 and 7 days out, then overdue, each once per
 * due date. Only obligations created or changed since reminders were
 * switched on are looked at, so switching on does not fire a burst about
 * everything already on the calendar; the first edit of an old one (setting
 * its date, confirming it) brings it in.
 */
export async function runComplianceReminders(organizationId: string, settings: BackOfficeSettings, now = new Date()): Promise<{ sent: number; overdue: number }> {
  if (!settings.complianceRemindersOn || !settings.complianceRemindersStartedAt) return { sent: 0, overdue: 0 };
  const { obligations } = await listObligations(organizationId, settings.reminderDays, now);
  const today = businessToday(now);
  let sent = 0;
  let overdue = 0;
  for (const o of obligations) {
    if (!o.active || !o.dueOn) continue;
    if (!afterStart(o.updatedAt, settings.complianceRemindersStartedAt) && !afterStart(o.createdAt, settings.complianceRemindersStartedAt)) continue;
    const due = reminderDue(o.dueOn, today, settings.reminderDays);
    if (due == null) continue;
    if (due === "overdue") overdue++;
    sent += await tellOwner(organizationId, reminderText(o, due, today), `compliance:${o.id}:${o.dueOn}:${due}`);
  }
  return { sent, overdue };
}

/* ---------------------------------------------------------------- COIs */

export interface ClientCoi {
  id: string;
  holderName: string;
  createdAt: string;
  sentAt: string | null;
  sentTo: string | null;
  filePath: string;
}

export async function listClientCois(organizationId: string, customerId: string): Promise<ClientCoi[]> {
  const { data } = await admin()
    .from("client_cois")
    .select("id, holder_name, created_at, sent_at, sent_to, file_path")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(10);
  return ((data ?? []) as { id: string; holder_name: string; created_at: string; sent_at: string | null; sent_to: string | null; file_path: string }[]).map((r) => ({
    id: r.id,
    holderName: r.holder_name,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    sentTo: r.sent_to,
    filePath: r.file_path,
  }));
}

/** The insurance on file, for a COI and for the panel's COI card. */
export async function insuranceOnFile(organizationId: string): Promise<Obligation[]> {
  const { data } = await admin().from("compliance_obligations").select("*").eq("organization_id", organizationId).in("kind", INSURANCE_KINDS).eq("active", true);
  const today = businessToday();
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toObligation(r, today, [60, 30, 7]));
}

/**
 * A certificate of insurance as a PDF: the business's policies on file,
 * with the client as certificate holder.
 *
 * This is evidence of the coverage, written from what the owner entered;
 * it does not amend or extend any policy, and it says so. A client who
 * needs the insurer's ACORD form, or an additional-insured endorsement, gets
 * it from the agent; the PDF says that too, rather than pretending to be it.
 */
export async function renderCoiPdf(input: {
  business: { name: string; address: string | null; phone: string | null; email: string | null };
  holder: { name: string; address: string | null };
  additionalInsured: boolean;
  policies: Obligation[];
  issuedOn: string;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  let y = 740;
  const left = 54;
  const width = 504;
  const text = (s: string, size = 10, f = font, color = ink) => {
    page.drawText(latin1(s), { x: left, y, size, font: f, color });
    y -= size + 6;
  };
  const para = (s: string, size = 9, color = muted) => {
    for (const line of wrapText(latin1(s), width, 12, (l) => font.widthOfTextAtSize(l, size))) {
      page.drawText(line, { x: left, y, size, font, color });
      y -= size + 4;
    }
    y -= 4;
  };

  text("Certificate of insurance", 18, bold);
  text(`Issued ${input.issuedOn}`, 9, font, muted);
  y -= 6;
  text("Insured", 11, bold);
  text(input.business.name);
  if (input.business.address) text(input.business.address);
  const contact = [input.business.phone, input.business.email].filter(Boolean).join(" · ");
  if (contact) text(contact);
  y -= 6;
  text("Certificate holder", 11, bold);
  text(input.holder.name);
  if (input.holder.address) text(input.holder.address);
  y -= 6;
  text("Coverage on file", 11, bold);
  if (input.policies.length === 0) para("No policies are on file yet.");
  for (const p of input.policies) {
    text(KIND_LABEL[p.kind as ObligationKind] ?? p.title, 10, bold);
    const bits = [
      p.carrier ? `Carrier: ${p.carrier}` : null,
      p.policyNumber ? `Policy: ${p.policyNumber}` : null,
      p.coverageLimits ? `Limits: ${p.coverageLimits}` : null,
      p.dueOn ? `Expires: ${p.dueOn}` : null,
    ].filter(Boolean) as string[];
    para(bits.join("   ") || "Details not entered.", 9, ink);
  }
  y -= 6;
  if (input.additionalInsured) {
    para("The certificate holder asked to be named as additional insured. Additional-insured status exists only where the policy grants it by endorsement; the endorsement comes from our insurance agent on request.");
  }
  para(
    "This certificate is issued as a matter of information only and confers no rights upon the certificate holder. It does not amend, extend or alter the coverage afforded by the policies listed. For the insurer's own certificate (ACORD 25) or any endorsement, ask us and we will have our agent send it."
  );
  return pdf.save();
}

/** A signed link to a stored compliance file, for a few minutes or for an email. */
export async function signedComplianceUrl(path: string, seconds = 60 * 10): Promise<string | null> {
  const { data } = await admin().storage.from(COMPLIANCE_BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

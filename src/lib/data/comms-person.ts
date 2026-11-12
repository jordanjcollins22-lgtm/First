import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { scheduleSuggestions } from "@/lib/data/schedule-engine";
import { EMPTY_RAW, dollarsToCents, type PersonRaw } from "@/lib/comms-person";
import type { MaterialFact, SlotFact } from "@/lib/comms-intents";
import type { ProposalZoneSnapshot } from "@/types/domain";

/**
 * One person's whole record, for their card on the Communications Board and
 * for Breakdown: contact, property, estimates, proposals, invoices and
 * payments, calendar, jobs, photos, notes, and what is still open.
 *
 * Read with the signed-in user's client, so row level security decides what
 * the board can see. Every read is allowed to come back empty: a table a
 * deployment does not have yet costs its section, not the card.
 */

type Row = Record<string, unknown>;

async function rows(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<Row[]> {
  try {
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as Row[];
  } catch {
    return [];
  }
}

const s = (v: unknown) => (typeof v === "string" ? v : null);
const n = (v: unknown) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

export interface PersonLoadInput {
  customerId: string | null;
  jobIds: string[];
  /** Ask the scheduler for open days. Only Breakdown and a paid proposal need it. */
  withSlots?: boolean;
}

export async function loadPersonRaw(input: PersonLoadInput): Promise<PersonRaw> {
  const sb = (await createClient()) as unknown as SupabaseClient;
  const raw: PersonRaw = structuredClone(EMPTY_RAW);
  const customerId = input.customerId;

  if (customerId) {
    const [c] = await rows(sb.from("customers").select("id, name, phone, email, notes, tags, source, contact_type, do_not_contact, created_at").eq("id", customerId).limit(1));
    if (c) {
      raw.customer = {
        id: String(c.id),
        name: s(c.name) ?? "",
        phone: s(c.phone),
        email: s(c.email),
        notes: s(c.notes),
        tags: Array.isArray(c.tags) ? (c.tags as string[]) : [],
        source: s(c.source),
        contactType: s(c.contact_type),
        doNotContact: Boolean(c.do_not_contact),
        createdAt: s(c.created_at),
      };
    }
    raw.properties = (await rows(sb.from("properties").select("id, address, sqft, acreage, notes").eq("customer_id", customerId).limit(20))).map((p) => ({
      id: String(p.id),
      address: s(p.address) ?? "",
      sqft: n(p.sqft),
      acreage: n(p.acreage),
      notes: s(p.notes),
    }));
  }

  const propertyIds = raw.properties.map((p) => p.id);
  const jobRows = [
    ...(propertyIds.length ? await rows(sb.from("jobs").select("*").in("property_id", propertyIds).order("created_at", { ascending: false }).limit(30)) : []),
    ...(input.jobIds.length ? await rows(sb.from("jobs").select("*").in("id", input.jobIds.slice(0, 30))) : []),
  ];
  const seen = new Set<string>();
  raw.jobs = jobRows
    .filter((j) => !seen.has(String(j.id)) && seen.add(String(j.id)))
    .map((j) => ({
      id: String(j.id),
      name: s(j.name),
      jobNumber: j.job_number == null ? null : String(j.job_number),
      status: s(j.status) ?? "",
      createdAt: s(j.created_at) ?? "",
      evaluationDate: s(j.evaluation_date),
      projectStartDate: s(j.project_start_date),
      projectEndDate: s(j.project_end_date),
      completedAt: s(j.completed_at),
      heardAbout: s(j.heard_about),
      clientNotes: s(j.client_notes),
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const jobIds = raw.jobs.map((j) => j.id);

  const [proposals, archived, invoices, clientInvoices, payments, sessions, photos, calls] = await Promise.all([
    jobIds.length ? rows(sb.from("job_proposals").select("*").in("job_id", jobIds)) : [],
    customerId ? rows(sb.from("archived_proposals").select("id, title, outcome, amount, job_date").eq("customer_id", customerId).limit(20)) : [],
    jobIds.length ? rows(sb.from("invoices").select("id, job_id, status, amount, sent_at, paid_at, hosted_invoice_url").in("job_id", jobIds)) : [],
    customerId ? rows(sb.from("client_invoices").select("id, invoice_number, title, amount, issued_on, paid_on").eq("customer_id", customerId).limit(30)) : [],
    customerId
      ? rows(sb.from("payments").select("id, job_id, amount_cents, method, received_at").eq("customer_id", customerId).order("received_at", { ascending: false }).limit(30))
      : jobIds.length
        ? rows(sb.from("payments").select("id, job_id, amount_cents, method, received_at").in("job_id", jobIds).limit(30))
        : [],
    jobIds.length ? rows(sb.from("job_work_sessions").select("id, job_id, starts_on, ends_on, status, purpose").in("job_id", jobIds).order("starts_on").limit(60)) : [],
    jobIds.length ? rows(sb.from("job_photos").select("job_id").in("job_id", jobIds).limit(2000)) : [],
    customerId ? rows(sb.from("proposal_calls").select("outcome, note, callback_on, created_at").eq("customer_id", customerId).not("callback_on", "is", null).order("created_at", { ascending: false }).limit(5)) : [],
  ]);

  raw.proposals = proposals.map((p) => {
    const est = (p.estimate ?? null) as { crew?: number; days?: number; billedHours?: number; costs?: { materialsCents?: number } } | null;
    const zones = (Array.isArray(p.scope_snapshot) ? (p.scope_snapshot as ProposalZoneSnapshot[]) : []).map((z) => ({
      name: z.zoneName,
      service: z.serviceLabel,
      scope: z.scopeText,
      priceCents: z.priceCents ?? null,
    }));
    return {
      id: String(p.id),
      jobId: String(p.job_id),
      token: s(p.token) ?? "",
      status: s(p.status) ?? "",
      totalCents: dollarsToCents(n(p.total_cost)),
      sentAt: s(p.sent_at),
      paidAt: s(p.paid_at),
      paymentPath: s(p.payment_path),
      estimate: est ? { crew: est.crew ?? 0, days: est.days ?? 0, billedHours: est.billedHours ?? 0, materialsCents: est.costs?.materialsCents ?? null } : null,
      zones,
    };
  });
  raw.archivedProposals = archived.map((a) => ({ id: String(a.id), title: s(a.title), outcome: s(a.outcome), amountCents: dollarsToCents(n(a.amount)), jobDate: s(a.job_date) }));
  raw.invoices = invoices.map((i) => ({
    id: String(i.id),
    jobId: String(i.job_id),
    status: s(i.status) ?? "",
    amountCents: dollarsToCents(n(i.amount)) ?? 0,
    sentAt: s(i.sent_at),
    paidAt: s(i.paid_at),
    hostedUrl: s(i.hosted_invoice_url),
  }));
  raw.clientInvoices = clientInvoices.map((i) => ({
    id: String(i.id),
    number: s(i.invoice_number),
    title: s(i.title),
    amountCents: dollarsToCents(n(i.amount)),
    issuedOn: s(i.issued_on),
    paidOn: s(i.paid_on),
  }));
  raw.payments = payments.map((p) => ({ id: String(p.id), jobId: s(p.job_id), amountCents: n(p.amount_cents) ?? 0, method: s(p.method), receivedAt: s(p.received_at) ?? "" }));
  raw.sessions = sessions.map((x) => ({ id: String(x.id), jobId: String(x.job_id), startsOn: s(x.starts_on) ?? "", endsOn: s(x.ends_on), status: s(x.status) ?? "", purpose: s(x.purpose) }));
  const photoCounts = new Map<string, number>();
  for (const p of photos) photoCounts.set(String(p.job_id), (photoCounts.get(String(p.job_id)) ?? 0) + 1);
  raw.photos = [...photoCounts].map(([jobId, count]) => ({ jobId, count }));
  raw.callbacks = calls.map((c) => ({ outcome: s(c.outcome) ?? "", note: s(c.note), callbackOn: s(c.callback_on), createdAt: s(c.created_at) ?? "" }));

  const newest = raw.jobs[0];
  if (newest) {
    raw.materials = await materialsFor(sb, newest.id, raw.proposals.find((p) => p.jobId === newest.id) ?? null);
    const accepted = raw.proposals.some((p) => p.jobId === newest.id && p.status === "accepted");
    if (input.withSlots && accepted && !newest.projectStartDate) raw.slots = await slotsFor(newest.id);
  }
  return raw;
}

/** What the job needs: purchasing's takeoff when it has run, else the estimate's own list. */
async function materialsFor(sb: SupabaseClient, jobId: string, proposal: { id: string } | null): Promise<MaterialFact[]> {
  const [takeoff] = await rows(sb.from("job_material_takeoffs").select("lines").eq("job_id", jobId).limit(1));
  const lines = Array.isArray(takeoff?.lines) ? (takeoff.lines as Row[]) : [];
  if (lines.length) {
    return lines.map((l) => {
      const unit = s(l.unit) ?? "";
      const toOrder = n(l.toOrder) ?? 0;
      return { name: s(l.name) ?? "Material", quantity: `${n(l.needed) ?? 0} ${unit}`.trim(), toOrder: toOrder > 0 ? `${toOrder} ${unit}`.trim() : null };
    });
  }
  if (!proposal) return [];
  const [p] = await rows(sb.from("job_proposals").select("estimate").eq("id", proposal.id).limit(1));
  const materials = ((p?.estimate as { materials?: { name: string; quantityLabel: string }[] } | null)?.materials ?? []).slice(0, 30);
  // No takeoff yet: nothing has been taken off the shelf, so all of it is still to get.
  return materials.map((m) => ({ name: m.name, quantity: m.quantityLabel, toOrder: m.quantityLabel }));
}

/** Open days the scheduling engine suggests for this job, best first. */
async function slotsFor(jobId: string): Promise<SlotFact[]> {
  try {
    const out = await scheduleSuggestions();
    return out.suggestions
      .filter((x) => x.jobId === jobId)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((x) => ({ date: x.date, crewNames: x.crewNames, crewProfileIds: x.crewProfileIds, because: x.because }));
  } catch {
    return [];
  }
}

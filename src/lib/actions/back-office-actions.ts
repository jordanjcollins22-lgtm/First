"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { getRealProfile } from "@/lib/data/team";
import { canSell, isOwnerLevel } from "@/lib/roles";
import { log } from "@/lib/log";
import { rollForward, type Recurrence } from "@/lib/compliance/calendar";
import { checklistFor } from "@/lib/hr/onboarding";
import { SETTING_COLUMN, STARTED_COLUMN, loadBackOfficeSettingsAdmin, type EditableSetting } from "@/lib/data/back-office-settings";
import { approveBatch } from "@/lib/data/commission-accrual";
import { COMPLIANCE_BUCKET, businessToday, insuranceOnFile, renderCoiPdf, seedMarylandDefaults, signedComplianceUrl } from "@/lib/data/compliance";
import { HR_BUCKET } from "@/lib/data/onboarding";
import { contactsFor, quietWindowFor, sendClientMessage } from "@/lib/data/client-messaging";

/**
 * Everything the back-office panels change: switches, commission rates and
 * payouts, the compliance calendar and its documents, COIs, onboarding
 * checklists and role fixes.
 *
 * Every action is owner-level only, checked against the real signed-in
 * account (not a view-as), and every write is scoped to the owner's own
 * organisation. Writes go through the service role after that check because
 * several of these tables have no policy a plain session could use.
 */

type Result = { ok: true; message?: string } | { ok: false; error: string };

const admin = () => createAdminClient() as unknown as SupabaseClient;

async function owner(): Promise<{ id: string; organizationId: string } | null> {
  const profile = await getRealProfile();
  if (!profile || !isOwnerLevel(profile.roles)) return null;
  return { id: profile.id, organizationId: profile.organization_id };
}

/**
 * Certificates of insurance for a client: the owner, or the account manager
 * who looks after the client. The policies on them are the business's, set
 * by the owner in Compliance; making and sending one is client service.
 */
async function clientDesk(): Promise<{ id: string; organizationId: string } | null> {
  const profile = await getRealProfile();
  if (!profile || !(isOwnerLevel(profile.roles) || canSell(profile.roles))) return null;
  return { id: profile.id, organizationId: profile.organization_id };
}

const NOT_OWNER: Result = { ok: false, error: "Only the owner can change this." };

function refresh() {
  revalidatePath("/v2", "layout");
}

/* --------------------------------------------------------------- settings */

/**
 * Change one switch or number. The first time a switch goes on it records
 * when, and the automation only ever acts on what happens after that.
 */
export async function saveBackOfficeSetting(key: EditableSetting, value: boolean | number): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  const column = SETTING_COLUMN[key];
  if (!column) return { ok: false, error: "Unknown setting." };
  if (typeof value === "number" && (!Number.isFinite(value) || value < 0 || value > 1000)) return { ok: false, error: "That number isn't valid." };
  const patch: Record<string, unknown> = { organization_id: who.organizationId, [column]: value, updated_at: new Date().toISOString(), updated_by: who.id };
  const startedColumn = STARTED_COLUMN[key];
  if (startedColumn && value === true) {
    const current = await loadBackOfficeSettingsAdmin(who.organizationId);
    const started =
      key === "commissionAccrualOn" ? current.commissionAccrualStartedAt : key === "complianceRemindersOn" ? current.complianceRemindersStartedAt : current.onboardingStartedAt;
    if (!started) patch[startedColumn] = new Date().toISOString();
  }
  const { error } = await admin().from("back_office_settings").upsert(patch, { onConflict: "organization_id" });
  if (error) return { ok: false, error: /does not exist|schema cache/i.test(error.message) ? "The back-office tables aren't set up yet (migration 0364)." : error.message };
  // Turning the calendar's reminders on puts the Maryland defaults on it, if it is empty.
  if (key === "complianceRemindersOn" && value === true) await seedMarylandDefaults(who.organizationId).catch(() => 0);
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------ commissions */

/** The owner approves the week's one total. Approving records every payout in it. */
export async function approveCommissionBatch(batchId: string): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  const result = await approveBatch({ organizationId: who.organizationId, batchId, approverId: who.id });
  if (!result.ok) return { ok: false, error: result.error };
  refresh();
  revalidatePath("/admin/payments");
  revalidatePath("/my-day");
  return { ok: true, message: `Approved. $${result.total.toFixed(2)} recorded as paid.` };
}

/** Put a rate on file for one person's share. */
export async function setCommissionRate(input: { profileId: string; role: "account_manager" | "evaluator" | "affiliate"; pct: number }): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  if (!Number.isFinite(input.pct) || input.pct < 0 || input.pct > 100) return { ok: false, error: "A rate is between 0 and 100%." };
  const sb = admin();
  const { data: person } = await sb.from("profiles").select("id").eq("id", input.profileId).eq("organization_id", who.organizationId).maybeSingle();
  if (!person) return { ok: false, error: "Couldn't find that person." };
  const { error } = await sb.from("commission_rates").upsert(
    { organization_id: who.organizationId, profile_id: input.profileId, role: input.role, pct: input.pct, set_by: who.id, set_at: new Date().toISOString() },
    { onConflict: "profile_id,role" }
  );
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------- compliance */

export async function seedComplianceDefaults(): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  const added = await seedMarylandDefaults(who.organizationId);
  refresh();
  return { ok: true, message: added ? `Added ${added} Maryland defaults. Confirm each date.` : "Everything is already on the calendar." };
}

export interface ObligationInput {
  id?: string | null;
  kind: string;
  title: string;
  holder?: string | null;
  dueOn?: string | null;
  recurrence?: Recurrence;
  active?: boolean;
  dateConfirmed?: boolean;
  creditsRequired?: number | null;
  creditsEarned?: number | null;
  carrier?: string | null;
  policyNumber?: string | null;
  coverageLimits?: string | null;
  notes?: string | null;
}

const clean = (s: string | null | undefined, max = 300) => (s ?? "").trim().slice(0, max) || null;

/** Add an obligation, or change one. Typing a date in counts as confirming it. */
export async function saveObligation(input: ObligationInput): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  const title = clean(input.title, 200);
  if (!title) return { ok: false, error: "Give it a name." };
  if (input.dueOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueOn)) return { ok: false, error: "That date isn't valid." };
  const row: Record<string, unknown> = {
    organization_id: who.organizationId,
    kind: clean(input.kind, 60) ?? "other",
    title,
    holder: clean(input.holder),
    due_on: input.dueOn || null,
    recurrence: input.recurrence ?? "annual",
    active: input.active ?? true,
    date_confirmed: input.dateConfirmed ?? Boolean(input.dueOn),
    credits_required: input.creditsRequired ?? null,
    credits_earned: input.creditsEarned ?? null,
    carrier: clean(input.carrier),
    policy_number: clean(input.policyNumber),
    coverage_limits: clean(input.coverageLimits),
    notes: clean(input.notes, 2000),
    updated_at: new Date().toISOString(),
  };
  const sb = admin();
  const { error } = input.id
    ? await sb.from("compliance_obligations").update(row).eq("id", input.id).eq("organization_id", who.organizationId)
    : await sb.from("compliance_obligations").insert(row);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** "Yes, that date is right." Brings a seeded default into the reminders. */
export async function confirmObligationDate(id: string): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  const { error } = await admin()
    .from("compliance_obligations")
    .update({ date_confirmed: true, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", who.organizationId);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** Renewed, filed or paid: roll the due date to the next one. */
export async function markObligationDone(id: string): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  const sb = admin();
  const { data } = await sb.from("compliance_obligations").select("due_on, recurrence, credits_required").eq("id", id).eq("organization_id", who.organizationId).maybeSingle();
  const row = data as { due_on: string | null; recurrence: Recurrence; credits_required: number | null } | null;
  if (!row) return { ok: false, error: "Couldn't find that." };
  const next = row.due_on ? rollForward(row.due_on, row.recurrence) : null;
  const { error } = await sb
    .from("compliance_obligations")
    .update({
      last_done_on: businessToday(),
      due_on: next ?? row.due_on,
      active: next != null || row.recurrence !== "none",
      // A renewed certification starts counting credits again.
      ...(row.credits_required != null ? { credits_earned: 0 } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true, message: next ? `Done. Next due ${next}.` : "Done." };
}

/* -------------------------------------------------------------- documents */

type DocArea = "obligation" | "onboarding";

const ALLOWED_TYPES = /^(application\/pdf|image\/(jpeg|png|webp|heic))$/;

async function docTarget(area: DocArea, id: string, organizationId: string): Promise<{ table: string; bucket: string } | null> {
  const table = area === "obligation" ? "compliance_obligations" : "onboarding_items";
  const { data } = await admin().from(table).select("id").eq("id", id).eq("organization_id", organizationId).maybeSingle();
  return data ? { table, bucket: area === "obligation" ? COMPLIANCE_BUCKET : HR_BUCKET } : null;
}

/** A one-time signed upload slot for a certificate, license or HR form. The browser uploads straight to it. */
export async function createDocUpload(input: { area: DocArea; id: string; fileType: string; fileSize: number }): Promise<{ ok: true; bucket: string; path: string; token: string } | { ok: false; error: string }> {
  const who = await owner();
  if (!who) return { ok: false, error: "Only the owner can upload this." };
  if (!ALLOWED_TYPES.test(input.fileType)) return { ok: false, error: "Upload a PDF or a photo." };
  if (input.fileSize > 15 * 1024 * 1024) return { ok: false, error: "That file is over 15 MB." };
  const target = await docTarget(input.area, input.id, who.organizationId);
  if (!target) return { ok: false, error: "Couldn't find what this is for." };
  const ext = input.fileType === "application/pdf" ? "pdf" : input.fileType.split("/")[1];
  const path = `${who.organizationId}/${input.area}/${input.id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await admin().storage.from(target.bucket).createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Couldn't start the upload. Is the storage bucket set up (migration 0364)?" };
  return { ok: true, bucket: target.bucket, path, token: data.token };
}

/** Record an uploaded file against its obligation or checklist item. An HR form uploaded also ticks the item. */
export async function attachDoc(input: { area: DocArea; id: string; path: string }): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  if (!input.path.startsWith(`${who.organizationId}/${input.area}/${input.id}/`)) return { ok: false, error: "That file isn't for this." };
  const target = await docTarget(input.area, input.id, who.organizationId);
  if (!target) return { ok: false, error: "Couldn't find what this is for." };
  const patch: Record<string, unknown> =
    input.area === "obligation"
      ? { document_path: input.path, updated_at: new Date().toISOString() }
      : { document_path: input.path, done_at: new Date().toISOString(), done_by: who.id };
  const { error } = await admin().from(target.table).update(patch).eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}

/** A short-lived link to look at a stored document. */
export async function openDoc(input: { area: DocArea; id: string }): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const who = await owner();
  if (!who) return { ok: false, error: "Only the owner can open this." };
  const target = await docTarget(input.area, input.id, who.organizationId);
  if (!target) return { ok: false, error: "Couldn't find it." };
  const { data } = await admin().from(target.table).select("document_path").eq("id", input.id).maybeSingle();
  const path = (data as { document_path: string | null } | null)?.document_path;
  if (!path) return { ok: false, error: "Nothing uploaded yet." };
  const { data: signed } = await admin().storage.from(target.bucket).createSignedUrl(path, 60 * 10);
  return signed?.signedUrl ? { ok: true, url: signed.signedUrl } : { ok: false, error: "Couldn't open it." };
}

/* ------------------------------------------------------------------- COIs */

/** Make a certificate of insurance for a client who asked, and store it. */
export async function generateClientCoi(input: { customerId: string; holderName: string; holderAddress?: string | null; additionalInsured?: boolean }): Promise<{ ok: true; id: string; url: string | null } | { ok: false; error: string }> {
  const who = await clientDesk();
  if (!who) return { ok: false, error: "Only the owner or an account manager can do that." };
  const holderName = clean(input.holderName, 160);
  if (!holderName) return { ok: false, error: "Who is the certificate holder?" };
  const sb = admin();
  const [{ data: customer }, { data: org }, policies] = await Promise.all([
    sb.from("customers").select("id").eq("id", input.customerId).eq("organization_id", who.organizationId).maybeSingle(),
    sb.from("organizations").select("name, business_address, business_phone, business_email").eq("id", who.organizationId).maybeSingle(),
    insuranceOnFile(who.organizationId),
  ]);
  if (!customer) return { ok: false, error: "Couldn't find that client." };
  const current = policies.filter((p) => !p.dueOn || p.dueOn >= businessToday());
  if (current.length === 0) return { ok: false, error: "No current insurance is on file. Add the policies in Admin › Settings › Compliance first." };
  const o = (org ?? {}) as { name?: string; business_address?: string | null; business_phone?: string | null; business_email?: string | null };
  const bytes = await renderCoiPdf({
    business: { name: o.name ?? "JS Landscaping MD", address: o.business_address ?? null, phone: o.business_phone ?? null, email: o.business_email ?? null },
    holder: { name: holderName, address: clean(input.holderAddress, 300) },
    additionalInsured: Boolean(input.additionalInsured),
    policies: current,
    issuedOn: businessToday(),
  });
  const path = `${who.organizationId}/coi/${input.customerId}/${crypto.randomUUID()}.pdf`;
  const { error: uploadError } = await sb.storage.from(COMPLIANCE_BUCKET).upload(path, Buffer.from(bytes), { contentType: "application/pdf", upsert: false });
  if (uploadError) return { ok: false, error: "Couldn't store the certificate. Is the storage bucket set up (migration 0364)?" };
  const { data: row, error } = await sb
    .from("client_cois")
    .insert({ organization_id: who.organizationId, customer_id: input.customerId, holder_name: holderName, holder_address: clean(input.holderAddress, 300), additional_insured: Boolean(input.additionalInsured), file_path: path, created_by: who.id })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: error?.message ?? "Couldn't save it." };
  revalidatePath(`/clients/${input.customerId}`);
  return { ok: true, id: (row as { id: string }).id, url: await signedComplianceUrl(path) };
}

/** A link to look at a certificate already made. */
export async function openClientCoi(coiId: string): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const who = await clientDesk();
  if (!who) return { ok: false, error: "Only the owner or an account manager can do that." };
  const { data } = await admin().from("client_cois").select("file_path").eq("id", coiId).eq("organization_id", who.organizationId).maybeSingle();
  const path = (data as { file_path: string } | null)?.file_path;
  const url = path ? await signedComplianceUrl(path) : null;
  return url ? { ok: true, url } : { ok: false, error: "Couldn't open it." };
}

/**
 * Email a certificate to the client. Goes through the one door every
 * client message uses, so consent, do-not-contact and the log all apply.
 * Whoever presses Send is the approval. The email carries a link, valid
 * for 30 days, rather than an attachment.
 */
export async function sendClientCoi(coiId: string): Promise<Result> {
  const who = await clientDesk();
  if (!who) return { ok: false, error: "Only the owner or an account manager can send a certificate." };
  const sb = admin();
  const { data } = await sb.from("client_cois").select("id, customer_id, holder_name, file_path").eq("id", coiId).eq("organization_id", who.organizationId).maybeSingle();
  const coi = data as { id: string; customer_id: string; holder_name: string; file_path: string } | null;
  if (!coi) return { ok: false, error: "Couldn't find that certificate." };
  const [contacts, { data: org }] = await Promise.all([
    contactsFor([coi.customer_id]),
    sb.from("organizations").select("name, reminder_quiet_start, reminder_quiet_end, reminder_time_zone").eq("id", who.organizationId).maybeSingle(),
  ]);
  const contact = contacts.get(coi.customer_id);
  if (!contact?.email) return { ok: false, error: "This client has no email on file." };
  const url = await signedComplianceUrl(coi.file_path, 60 * 60 * 24 * 30);
  if (!url) return { ok: false, error: "Couldn't make a link to the certificate." };
  const business = (org as { name?: string } | null)?.name ?? "JS Landscaping MD";
  const outcome = await sendClientMessage(
    {
      organizationId: who.organizationId,
      customerId: coi.customer_id,
      channel: "email",
      basis: "service",
      kind: "certificate_of_insurance",
      referenceId: coi.id,
      dedupeKey: `coi:${coi.id}`,
      subject: `Certificate of insurance from ${business}`,
      body: `Hello,\n\nHere is our certificate of insurance, with ${coi.holder_name} as certificate holder:\n${url}\n\nThe link works for 30 days. If you need the insurer's own ACORD certificate or an additional-insured endorsement, reply and we'll have our agent send it.\n\nThank you,\n${business}`,
      automatic: false,
    },
    contact,
    quietWindowFor((org ?? {}) as { reminder_quiet_start?: number | null; reminder_quiet_end?: number | null; reminder_time_zone?: string | null })
  );
  if (!outcome.sent) {
    log.warn("coi.not_sent", { coiId, reason: outcome.reason });
    return { ok: false, error: outcome.reason === "already_sent" ? "This certificate was already sent." : outcome.detail };
  }
  await sb.from("client_cois").update({ sent_at: new Date().toISOString(), sent_to: contact.email }).eq("id", coi.id);
  revalidatePath(`/clients/${coi.customer_id}`);
  return { ok: true, message: `Sent to ${contact.email}.` };
}

/* ------------------------------------------------------------- onboarding */

/** Tick, waive or untick one checklist item. */
export async function setOnboardingItem(input: { itemId: string; state: "done" | "waived" | "open" }): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  const patch =
    input.state === "done"
      ? { done_at: new Date().toISOString(), done_by: who.id, waived: false }
      : input.state === "waived"
        ? { done_at: null, done_by: who.id, waived: true }
        : { done_at: null, done_by: null, waived: false };
  const sb = admin();
  const { data, error } = await sb.from("onboarding_items").update(patch).eq("id", input.itemId).eq("organization_id", who.organizationId).select("checklist_id").maybeSingle();
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't find that item." };
  // The checklist is complete when nothing on it is left open.
  const checklistId = (data as { checklist_id: string }).checklist_id;
  const { data: open } = await sb.from("onboarding_items").select("id").eq("checklist_id", checklistId).is("done_at", null).eq("waived", false).limit(1);
  await sb.from("onboarding_checklists").update({ completed_at: (open ?? []).length === 0 ? new Date().toISOString() : null }).eq("id", checklistId);
  refresh();
  return { ok: true };
}

/** Change a hire's first day or whether they handle pesticides; the due dates follow. Ticked items keep their tick. */
export async function updateChecklist(input: { checklistId: string; startDate?: string; handlesPesticides?: boolean }): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  const sb = admin();
  const { data } = await sb.from("onboarding_checklists").select("id, position, start_date, handles_pesticides").eq("id", input.checklistId).eq("organization_id", who.organizationId).maybeSingle();
  const c = data as { id: string; position: string | null; start_date: string; handles_pesticides: boolean } | null;
  if (!c) return { ok: false, error: "Couldn't find that checklist." };
  if (input.startDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return { ok: false, error: "That date isn't valid." };
  const startDate = input.startDate ?? c.start_date;
  const handles = input.handlesPesticides ?? c.handles_pesticides;
  await sb.from("onboarding_checklists").update({ start_date: startDate, handles_pesticides: handles }).eq("id", c.id);
  const items = checklistFor({ position: c.position, startDate, handlesPesticides: handles });
  for (const i of items) {
    await sb.from("onboarding_items").upsert({ organization_id: who.organizationId, checklist_id: c.id, key: i.key, label: i.label, due_on: i.dueOn }, { onConflict: "checklist_id,key" });
  }
  if (!handles) await sb.from("onboarding_items").delete().eq("checklist_id", c.id).eq("key", "pesticide_training").is("done_at", null);
  refresh();
  return { ok: true };
}

/* ------------------------------------------------------------------ roles */

/** The one-tap fix from the role-mapping list: add and take away role names. */
export async function fixProfileRoles(input: { profileId: string; add: string[]; remove: string[] }): Promise<Result> {
  const who = await owner();
  if (!who) return NOT_OWNER;
  const sb = admin();
  const { data: person } = await sb.from("profiles").select("id").eq("id", input.profileId).eq("organization_id", who.organizationId).maybeSingle();
  if (!person) return { ok: false, error: "Couldn't find that person." };
  if (input.profileId === who.id && input.remove.some((r) => ["admin", "owner"].includes(r.toLowerCase()))) {
    return { ok: false, error: "You can't take away your own owner role here." };
  }
  if (input.add.length) {
    const { data: known } = await sb.from("roles").select("name").in("name", input.add);
    const missing = input.add.filter((n) => !((known ?? []) as { name: string }[]).some((k) => k.name === n));
    if (missing.length) return { ok: false, error: `The role "${missing[0]}" doesn't exist yet. Add it under Roles first.` };
    const { error } = await sb.from("profile_roles").upsert(
      input.add.map((role_name) => ({ profile_id: input.profileId, role_name })),
      { onConflict: "profile_id,role_name", ignoreDuplicates: true }
    );
    if (error) return { ok: false, error: error.message };
  }
  if (input.remove.length) {
    const { error } = await sb.from("profile_roles").delete().eq("profile_id", input.profileId).in("role_name", input.remove);
    if (error) return { ok: false, error: error.message };
  }
  refresh();
  revalidatePath("/admin/team");
  return { ok: true };
}

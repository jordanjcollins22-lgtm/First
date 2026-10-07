"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { refuseInDemo } from "@/lib/demo-mode";
import { isOwnerLevel } from "@/lib/roles";
import { outboundBaseUrl } from "@/lib/base-url";
import { stopCompany } from "@/lib/data/pm-sender";
import { runPmOutreach } from "@/lib/data/pm-run";
import { hostOf, stepSchedule } from "@/lib/pm-outreach";
import { sequenceProblems } from "@/lib/pm-writer-prompt";

export type PmResult = { ok: true; message: string } | { ok: false; message: string };

const PATH = "/marketing";

/** The owner's business, or the reason they can't do this. */
async function ownerOrg(): Promise<{ organizationId: string } | { refused: string }> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { refused: "Sign in first." };
  if (!isOwnerLevel(profile.roles)) return { refused: "Only an owner can run cold email." };
  return { organizationId: profile.organization_id };
}

export async function savePmSettings(input: {
  sendingOn: boolean;
  autoApprove: boolean;
  dailyCap: number;
  fromName: string;
  story: string;
  offer: string;
  towns: string;
}): Promise<PmResult> {
  const who = await ownerOrg();
  if ("refused" in who) return { ok: false, message: who.refused };
  const cap = Math.round(Number(input.dailyCap));
  if (!Number.isFinite(cap) || cap < 1 || cap > 50) return { ok: false, message: "Keep the daily cap between 1 and 50. More than that from one mailbox lands in spam." };
  if (input.story.trim().length < 40) return { ok: false, message: "The story is too short to write from." };
  const towns = input.towns
    .split(/\n|;/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
  const admin = createAdminClient();
  const { error } = await admin
    .from("pm_outreach_settings")
    .upsert(
      {
        organization_id: who.organizationId,
        sending_on: input.sendingOn,
        auto_approve: input.autoApprove,
        daily_cap: cap,
        from_name: input.fromName.trim() || null,
        story: input.story.trim(),
        offer: input.offer.trim(),
        towns,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id" }
    );
  if (error) return { ok: false, message: "Couldn't save. Try again." };
  revalidatePath(PATH);
  return { ok: true, message: input.sendingOn ? "Saved. Sending is on." : "Saved." };
}

/**
 * Save the edits to a company's emails and, if asked, approve them: each is
 * given its send time, the first in the next sending window.
 */
export async function saveSequence(input: { companyId: string; emails: { id: string; subject: string; body: string }[]; approve: boolean }): Promise<PmResult> {
  const who = await ownerOrg();
  if ("refused" in who) return { ok: false, message: who.refused };
  const admin = createAdminClient();
  const { data: company } = await admin.from("pm_companies").select("id, status, email").eq("id", input.companyId).eq("organization_id", who.organizationId).maybeSingle();
  if (!company) return { ok: false, message: "Couldn't find that company." };
  if (!["drafted", "approved"].includes(company.status)) return { ok: false, message: "This company's emails can't be changed now." };
  if (input.approve && !company.email) return { ok: false, message: "Add an email address first." };

  const { data: current } = await admin.from("pm_emails").select("id, step, status").eq("company_id", company.id).order("step");
  const editable = (current ?? []).filter((e) => e.status === "draft" || e.status === "scheduled");
  const edits = new Map(input.emails.map((e) => [e.id, e]));
  const checked = editable.map((e) => ({ step: e.step, subject: edits.get(e.id)?.subject ?? "", body: edits.get(e.id)?.body ?? "" }));
  if (checked.some((e) => !e.subject.trim() || !e.body.trim())) return { ok: false, message: "Every email needs a subject and a body." };
  const problems = sequenceProblems({ emails: checked });
  if (problems.length) return { ok: false, message: problems.join(" ") };

  const when = stepSchedule(new Date(), company.id);
  for (const email of editable) {
    const edit = edits.get(email.id);
    if (!edit) continue;
    await admin
      .from("pm_emails")
      .update({
        subject: edit.subject.trim().slice(0, 140),
        body: edit.body.trim(),
        ...(input.approve ? { status: "scheduled", send_after: when[email.step - 1]?.toISOString() ?? null } : {}),
      })
      .eq("id", email.id);
  }
  if (input.approve) {
    await admin.from("pm_companies").update({ status: "approved", updated_at: new Date().toISOString() }).eq("id", company.id);
  }
  revalidatePath(PATH);
  return { ok: true, message: input.approve ? "Approved. The first one goes in the next sending window." : "Saved." };
}

/** Throw the emails away and have them written again on the next run. */
export async function rewriteSequence(companyId: string): Promise<PmResult> {
  const who = await ownerOrg();
  if ("refused" in who) return { ok: false, message: who.refused };
  const admin = createAdminClient();
  const { data: company } = await admin.from("pm_companies").select("id, status, email").eq("id", companyId).eq("organization_id", who.organizationId).maybeSingle();
  if (!company?.email) return { ok: false, message: "Couldn't find that company's email." };
  if (!["drafted", "approved"].includes(company.status)) return { ok: false, message: "This company's emails can't be rewritten now." };
  const { count } = await admin.from("pm_emails").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "sent");
  if ((count ?? 0) > 0) return { ok: false, message: "Some of these have already gone, so they stay as they are." };
  await admin.from("pm_emails").delete().eq("company_id", companyId).in("status", ["draft", "scheduled"]);
  await admin.from("pm_companies").update({ status: "ready", updated_at: new Date().toISOString() }).eq("id", companyId);
  revalidatePath(PATH);
  return { ok: true, message: "They'll be written again in the next run." };
}

/** Where a company stands after a conversation: it stops their emails either way. */
export async function markCompany(companyId: string, status: "interested" | "not_interested" | "do_not_contact"): Promise<PmResult> {
  const who = await ownerOrg();
  if ("refused" in who) return { ok: false, message: who.refused };
  const admin = createAdminClient();
  const { data: company } = await admin.from("pm_companies").select("id").eq("id", companyId).eq("organization_id", who.organizationId).maybeSingle();
  if (!company) return { ok: false, message: "Couldn't find that company." };
  await stopCompany(admin, companyId, status);
  revalidatePath(PATH);
  return { ok: true, message: "Marked. No more emails go to them." };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,24}$/i;

/** Give a company the address to write to, found by hand. */
export async function setCompanyEmail(companyId: string, email: string, contactName: string): Promise<PmResult> {
  const who = await ownerOrg();
  if ("refused" in who) return { ok: false, message: who.refused };
  const address = email.trim().toLowerCase();
  if (!EMAIL.test(address)) return { ok: false, message: "That doesn't look like an email address." };
  const admin = createAdminClient();
  const { data: company } = await admin.from("pm_companies").select("id, status").eq("id", companyId).eq("organization_id", who.organizationId).maybeSingle();
  if (!company) return { ok: false, message: "Couldn't find that company." };
  if (!["new", "no_email", "ready", "bounced"].includes(company.status)) return { ok: false, message: "Their emails are already written. Change it on the emails instead." };
  await admin
    .from("pm_companies")
    .update({ email: address, email_source: "manual", contact_name: contactName.trim() || null, status: "ready", last_error: null, updated_at: new Date().toISOString() })
    .eq("id", companyId);
  revalidatePath(PATH);
  return { ok: true, message: "Saved. Their emails are written in the next run." };
}

/** A company the office knows of that the search didn't find. */
export async function addCompany(input: { name: string; email: string; contactName: string; website: string; phone: string; address: string }): Promise<PmResult> {
  const who = await ownerOrg();
  if ("refused" in who) return { ok: false, message: who.refused };
  const name = input.name.trim();
  if (!name) return { ok: false, message: "Give the company's name." };
  const email = input.email.trim().toLowerCase();
  if (email && !EMAIL.test(email)) return { ok: false, message: "That doesn't look like an email address." };
  const website = input.website.trim();
  const admin = createAdminClient();
  if (email) {
    const { count } = await admin.from("pm_companies").select("id", { count: "exact", head: true }).eq("organization_id", who.organizationId).eq("email", email);
    if ((count ?? 0) > 0) return { ok: false, message: "That email is already on the list." };
  }
  const { error } = await admin.from("pm_companies").insert({
    organization_id: who.organizationId,
    name: name.slice(0, 160),
    email: email || null,
    email_source: email ? "manual" : null,
    contact_name: input.contactName.trim() || null,
    website: website ? (hostOf(website) ? website : null) : null,
    phone: input.phone.trim() || null,
    address: input.address.trim() || null,
    source: "manual",
    status: email ? "ready" : website ? "new" : "no_email",
  });
  if (error) return { ok: false, message: "Couldn't add it. Try again." };
  revalidatePath(PATH);
  return { ok: true, message: email ? "Added. Their emails are written in the next run." : "Added. It'll look for an email on their site." };
}

/** Run a pass now instead of waiting for the timer. */
export async function runPmNow(): Promise<PmResult> {
  const who = await ownerOrg();
  if ("refused" in who) return { ok: false, message: who.refused };
  const run = await runPmOutreach(createAdminClient(), who.organizationId, await outboundBaseUrl());
  revalidatePath(PATH);
  const parts = [
    `${run.found} new ${run.found === 1 ? "company" : "companies"}`,
    `${run.emailsFound} ${run.emailsFound === 1 ? "email" : "emails"} found`,
    `${run.written} ${run.written === 1 ? "sequence" : "sequences"} written`,
    `${run.sent} sent`,
  ];
  return { ok: true, message: `${parts.join(", ")}.${run.blocked ? ` ${run.blocked}` : ""}` };
}

"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { isOwnerLevel } from "@/lib/roles";
import { deliverApproval, settle } from "@/lib/data/outbound-approvals";
import { isStale } from "@/lib/outbound-approval";

export type ApprovalResult = { ok: true; message: string } | { ok: false; message: string };

async function allowed(): Promise<{ profileId: string; name: string; organizationId: string } | string> {
  const profile = await getCurrentProfile();
  if (!profile) return "Sign in first.";
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) return "Only an owner or admin can approve emails.";
  return { profileId: profile.id, name: profile.full_name || profile.email, organizationId: await getCurrentOrganizationId() };
}

function refresh() {
  revalidatePath("/my-day");
  revalidatePath("/admin/reminders");
}

/** Send it, now, as written, or as rewritten in the box. */
export async function approveOutbound(id: string, edits?: { subject?: string; body?: string }): Promise<ApprovalResult> {
  const who = await allowed();
  if (typeof who === "string") return { ok: false, message: who };

  const admin = createAdminClient();
  const subject = edits?.subject?.trim();
  const body = edits?.body?.trim();
  if (subject !== undefined || body !== undefined) {
    if (subject === "" || body === "") return { ok: false, message: "The email needs a subject and some words." };
    const { error } = await admin
      .from("outbound_approvals")
      .update({ ...(subject ? { subject } : {}), ...(body ? { body } : {}) })
      .eq("id", id)
      .eq("organization_id", who.organizationId)
      .eq("status", "pending");
    if (error) return { ok: false, message: error.message };
  }
  const { data: row } = await admin
    .from("outbound_approvals")
    .select("*")
    .eq("id", id)
    .eq("organization_id", who.organizationId)
    .eq("status", "pending")
    .maybeSingle();
  if (!row) return { ok: false, message: "That one has already been dealt with." };
  if (isStale(row.expires_at, new Date())) {
    await settle(admin, row, { status: "expired", detail: "Not approved in time.", decidedBy: who.profileId });
    refresh();
    return { ok: false, message: "Too late for that one. It has been closed unsent." };
  }
  const result = await deliverApproval(admin, row, who.profileId);
  refresh();
  return result;
}

/** Do not send it. Nothing else will try. */
export async function declineOutbound(id: string): Promise<ApprovalResult> {
  const who = await allowed();
  if (typeof who === "string") return { ok: false, message: who };

  const admin = createAdminClient();
  const { data: row } = await admin
    .from("outbound_approvals")
    .select("id, source, dedupe_key, organization_id, customer_id, kind, job_id, body")
    .eq("id", id)
    .eq("organization_id", who.organizationId)
    .eq("status", "pending")
    .maybeSingle();
  if (!row) return { ok: false, message: "That one has already been dealt with." };
  await settle(admin, row, { status: "declined", detail: `Declined by ${who.name}.`, decidedBy: who.profileId });
  refresh();
  return { ok: true, message: "Not sent." };
}

/** Everything waiting, sent as written. */
export async function approveAllOutbound(): Promise<ApprovalResult> {
  const who = await allowed();
  if (typeof who === "string") return { ok: false, message: who };

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("outbound_approvals")
    .select("*")
    .eq("organization_id", who.organizationId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(100);
  let sent = 0;
  let failed = 0;
  let late = 0;
  for (const row of rows ?? []) {
    if (isStale(row.expires_at, new Date())) {
      await settle(admin, row, { status: "expired", detail: "Not approved in time.", decidedBy: who.profileId });
      late += 1;
      continue;
    }
    const result = await deliverApproval(admin, row, who.profileId);
    if (result.ok) sent += 1;
    else failed += 1;
  }
  refresh();
  const parts = [`${sent} sent`];
  if (failed > 0) parts.push(`${failed} failed`);
  if (late > 0) parts.push(`${late} too late`);
  return { ok: failed === 0, message: parts.join(", ") + "." };
}

/** The switch: read everything first, or let it go on its own. */
export async function setEmailApprovalRequired(required: boolean): Promise<ApprovalResult> {
  const who = await allowed();
  if (typeof who === "string") return { ok: false, message: who };
  const admin = createAdminClient();
  const { error } = await admin.from("organizations").update({ require_email_approval: required }).eq("id", who.organizationId);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: required ? "Every automatic email now waits for you." : "Automatic emails go on their own again." };
}

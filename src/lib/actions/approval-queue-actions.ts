"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { getRealProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { isQueueType, type QueueType } from "@/lib/approvals/queue";
import { DECLINE_REASON_LABEL, isDeclineReason, type DeclineReason } from "@/lib/approvals/declines";
import { isApprovalMode, type ApprovalMode } from "@/lib/approvals/policy";
import { approveOutbound, declineOutbound } from "@/lib/actions/outbound-approval-actions";
import { acceptPrice } from "@/lib/actions/price-approval-actions";
import { approveMarketingPlay, setMarketingPlayStatus } from "@/lib/actions/marketing-actions";
import { markPosted } from "@/lib/actions/social-actions";
import { markCompany, rewriteSequence, saveSequence } from "@/lib/actions/pm-outreach-actions";
import { acknowledgeException, dismissException } from "@/lib/actions/exception-actions";
import { recordDecline } from "@/lib/data/approval-queue";
import { buildDigest, sendOwnerDigest } from "@/lib/data/owner-digest";

/**
 * The approval queue's buttons.
 *
 * Each one hands off to the action that already does the thing on its own
 * screen (approveOutbound, acceptPrice, approveMarketingPlay, markPosted,
 * saveSequence, acknowledgeException), so the queue adds no second way of
 * approving anything. What it adds is the reason on a "no", written to the
 * decline log whatever was declined.
 */

export type QueueResult = { ok: true; message: string } | { ok: false; message: string };

async function owner(): Promise<{ profileId: string; organizationId: string } | string> {
  const profile = await getRealProfile();
  if (!profile) return "Sign in first.";
  if (!isOwnerLevel(profile.roles)) return "Only an owner can work the approval queue.";
  return { profileId: profile.id, organizationId: profile.organization_id };
}

function refresh() {
  revalidatePath("/v2");
  revalidatePath("/my-day");
}

const db = () => createAdminClient() as unknown as SupabaseClient;

export async function approveQueueItem(type: string, id: string): Promise<QueueResult> {
  const who = await owner();
  if (typeof who === "string") return { ok: false, message: who };
  if (!isQueueType(type)) return { ok: false, message: "Unknown item." };

  const result = await approve(type, id, who.organizationId);
  refresh();
  return result;
}

async function approve(type: QueueType, id: string, organizationId: string): Promise<QueueResult> {
  switch (type) {
    case "email":
      return approveOutbound(id);
    case "price": {
      const done = await acceptPrice(id);
      return done.ok ? { ok: true, message: "Price accepted. Send it to the client from the job." } : { ok: false, message: done.error };
    }
    case "play": {
      const done = await approveMarketingPlay(id);
      return done.ok ? { ok: true, message: "Approved." } : { ok: false, message: done.error };
    }
    case "social": {
      if (!(await belongs("social_posts", id, organizationId))) return { ok: false, message: "That post isn't yours." };
      const done = await markPosted(id);
      return done.ok ? { ok: true, message: done.message ?? "Marked as posted." } : { ok: false, message: done.message };
    }
    case "pm_draft": {
      const { data } = await db().from("pm_emails").select("id, subject, body, status").eq("company_id", id).eq("organization_id", organizationId).order("step");
      const emails = ((data ?? []) as { id: string; subject: string; body: string; status: string }[])
        .filter((e) => e.status === "draft" || e.status === "scheduled")
        .map((e) => ({ id: e.id, subject: e.subject, body: e.body }));
      if (emails.length === 0) return { ok: false, message: "There are no drafts to approve." };
      return saveSequence({ companyId: id, emails, approve: true });
    }
    case "exception": {
      const done = await acknowledgeException(id);
      return done.ok ? { ok: true, message: "Picked up. It's yours now." } : { ok: false, message: done.error };
    }
  }
}

export async function declineQueueItem(type: string, id: string, reason: string, note?: string): Promise<QueueResult> {
  const who = await owner();
  if (typeof who === "string") return { ok: false, message: who };
  if (!isQueueType(type)) return { ok: false, message: "Unknown item." };
  if (!isDeclineReason(reason)) return { ok: false, message: "Pick a reason." };

  // An email writes its own decline log line, with the email's kind.
  if (type === "email") {
    const done = await declineOutbound(id, reason, note);
    refresh();
    return done;
  }

  const result = await decline(type, id, reason, note ?? null, who.organizationId);
  if (result.ok) {
    await recordDecline(createAdminClient(), {
      organizationId: who.organizationId,
      itemType: type,
      itemId: id,
      itemKind: await kindOf(type, id),
      reason,
      note: note ?? null,
      decidedBy: who.profileId,
    });
  }
  refresh();
  return result;
}

async function decline(type: Exclude<QueueType, "email">, id: string, reason: DeclineReason, note: string | null, organizationId: string): Promise<QueueResult> {
  const words = `${DECLINE_REASON_LABEL[reason]}${note?.trim() ? `: ${note.trim()}` : ""}`;
  switch (type) {
    case "price":
      // Saying no to a price is typing the right one, which happens on the
      // job. The reason is still kept, and the job opens from the row.
      if (!(await belongs("job_proposals", id, organizationId, "job_id"))) return { ok: false, message: "That proposal isn't yours." };
      return { ok: true, message: "Noted. Open the job to type the price it should be." };
    case "play": {
      const done = await setMarketingPlayStatus(id, "skipped");
      return done.ok ? { ok: true, message: "Skipped." } : { ok: false, message: done.error };
    }
    case "social": {
      if (!(await belongs("social_posts", id, organizationId))) return { ok: false, message: "That post isn't yours." };
      const { error } = await db()
        .from("social_posts")
        .update({ status: "skipped", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", organizationId)
        .eq("status", "scheduled");
      return error ? { ok: false, message: "Couldn't skip that post." } : { ok: true, message: "Won't be posted." };
    }
    case "pm_draft":
      // Bad wording is written again; anything else stops the company.
      return reason === "wording" ? rewriteSequence(id) : markCompany(id, "not_interested");
    case "exception": {
      const done = await dismissException(id, words);
      return done.ok ? { ok: true, message: "Dismissed." } : { ok: false, message: done.error };
    }
  }
}

/** Whether a row belongs to this business, before acting on it with an action that does not check. */
async function belongs(table: string, id: string, organizationId: string, column = "id"): Promise<boolean> {
  const { data } = await db().from(table).select(column).eq(column, id).eq("organization_id", organizationId).maybeSingle();
  return Boolean(data);
}

async function kindOf(type: QueueType, id: string): Promise<string | null> {
  if (type === "play") {
    const { data } = await db().from("marketing_plays").select("kind").eq("id", id).maybeSingle();
    return (data as { kind?: string } | null)?.kind ?? null;
  }
  if (type === "exception") {
    const { data } = await db().from("job_exceptions").select("kind").eq("id", id).maybeSingle();
    return (data as { kind?: string } | null)?.kind ?? null;
  }
  if (type === "social") return "social_post";
  if (type === "pm_draft") return "pm_draft";
  if (type === "price") return "price";
  return null;
}

/** One kind of automatic email: auto-send, hold, or hold and then send. */
export async function setEmailKindMode(kind: string, mode: string): Promise<QueueResult> {
  const who = await owner();
  if (typeof who === "string") return { ok: false, message: who };
  if (!isApprovalMode(mode)) return { ok: false, message: "Pick a setting." };
  if (!/^[a-z0-9_]{2,60}$/.test(kind)) return { ok: false, message: "Unknown email kind." };
  const { error } = await db()
    .from("email_approval_policy")
    .upsert(
      { organization_id: who.organizationId, kind, mode: mode as ApprovalMode, updated_at: new Date().toISOString(), updated_by: who.profileId },
      { onConflict: "organization_id,kind" }
    );
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  refresh();
  return { ok: true, message: "Saved." };
}

/** The Monday digest, on or off. Its first switch-on is recorded. */
export async function setDigestEnabled(on: boolean): Promise<QueueResult> {
  const who = await owner();
  if (typeof who === "string") return { ok: false, message: who };
  const now = new Date().toISOString();
  const client = db();
  await client.from("approval_settings").upsert({ organization_id: who.organizationId }, { onConflict: "organization_id", ignoreDuplicates: true });
  const { error } = await client
    .from("approval_settings")
    .update({ digest_enabled: on, updated_at: now, updated_by: who.profileId })
    .eq("organization_id", who.organizationId);
  if (error) return { ok: false, message: "Couldn't save that. Try again." };
  if (on) await client.from("approval_settings").update({ digest_started_at: now }).eq("organization_id", who.organizationId).is("digest_started_at", null);
  refresh();
  return { ok: true, message: on ? "The digest goes every Monday at 7am." : "No Monday digest." };
}

/** The digest as it would go now, to read on screen. Sends nothing. */
export async function previewDigest(): Promise<{ ok: true; subject: string; text: string } | { ok: false; message: string }> {
  const who = await owner();
  if (typeof who === "string") return { ok: false, message: who };
  const digest = await buildDigest(createAdminClient(), who.organizationId);
  return { ok: true, subject: digest.subject, text: digest.text };
}

/** This week's digest now, if it has not gone already. Still once a week. */
export async function sendDigestNow(): Promise<QueueResult> {
  const who = await owner();
  if (typeof who === "string") return { ok: false, message: who };
  const result = await sendOwnerDigest(createAdminClient(), who.organizationId);
  if (result.skipped) return { ok: false, message: `Not sent: ${result.skipped}.` };
  return result.sent > 0 ? { ok: true, message: "Sent." } : { ok: false, message: "Already sent this week, or nobody could be reached." };
}

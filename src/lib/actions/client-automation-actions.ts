"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getRealProfile } from "@/lib/data/team";
import { hasRole, isOwnerLevel } from "@/lib/roles";
import { refuseInDemo } from "@/lib/demo-mode";
import { outboundBaseUrl } from "@/lib/base-url";
import { untyped } from "@/lib/data/client-automations";
import { runRenewals, runSaltPresell, type CampaignKey } from "@/lib/data/client-campaigns";
import { recordProposalCall } from "@/lib/actions/proposal-call-actions";
import { isCallOutcome } from "@/lib/call-list";
import { cleanReviewLink, isSequenceKey, mergeConfig, nextStartedAt, type SequenceConfig } from "@/lib/client-automations/settings";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/** Owner-level, and not "viewing as" somebody else: the real person signed in. */
async function owner() {
  const profile = await getRealProfile();
  if (!profile) return { error: "Sign in first." } as const;
  if (!isOwnerLevel(profile.roles)) return { error: "Only an owner or admin can change automated messages." } as const;
  return { profile } as const;
}

function refresh() {
  revalidatePath("/v2", "layout");
}

/**
 * One sequence's switch and settings. The first time it goes on, the moment
 * is written down; from then on it only acts on what happens after.
 */
export async function saveSequenceSetting(input: { sequence: string; enabled: boolean; config?: SequenceConfig }): Promise<ActionResult> {
  const who = await owner();
  if ("error" in who) return { ok: false, message: who.error ?? "Not allowed." };
  if (!isSequenceKey(input.sequence)) return { ok: false, message: "Unknown message." };

  const sb = untyped(await createClient());
  const { data: current } = await sb
    .from("client_automation_settings")
    .select("started_at, config")
    .eq("organization_id", who.profile.organization_id)
    .eq("sequence", input.sequence)
    .maybeSingle();
  const row = current as { started_at: string | null; config: unknown } | null;

  const merged = { ...((row?.config as Record<string, unknown> | null) ?? {}), ...(input.config ?? {}) };
  if (input.config && "googleReviewLink" in input.config) {
    const link = cleanReviewLink(input.config.googleReviewLink);
    if (input.config.googleReviewLink && !link) return { ok: false, message: "The review link has to be a full https:// address." };
    merged.googleReviewLink = link;
  }
  if (input.sequence === "review_requests" && input.enabled && !mergeConfig(merged).googleReviewLink) {
    return { ok: false, message: "Add your Google review link first." };
  }

  const now = new Date();
  const startedAt = nextStartedAt(row?.started_at ? new Date(row.started_at) : null, input.enabled, now);
  const { error } = await sb.from("client_automation_settings").upsert(
    {
      organization_id: who.profile.organization_id,
      sequence: input.sequence,
      enabled: input.enabled,
      started_at: startedAt?.toISOString() ?? null,
      config: mergeConfig(merged),
      updated_at: now.toISOString(),
      updated_by: who.profile.id,
    },
    { onConflict: "organization_id,sequence" }
  );
  if (error) return { ok: false, message: error.message.includes("does not exist") ? "The new settings table isn't in the database yet." : error.message };
  refresh();
  return { ok: true, message: input.enabled ? "On. It acts only on what happens from now." : "Saved." };
}

/** One button: renewals or the salt pre-sell, to exactly the people the preview showed. */
export async function startCampaign(campaign: CampaignKey): Promise<ActionResult> {
  await refuseInDemo();
  const who = await owner();
  if ("error" in who) return { ok: false, message: who.error ?? "Not allowed." };
  const origin = await outboundBaseUrl();
  const run = campaign === "renewals" ? runRenewals : campaign === "salt_presell" ? runSaltPresell : null;
  if (!run) return { ok: false, message: "Unknown campaign." };
  const result = await run(who.profile.organization_id, who.profile.id, origin);
  refresh();
  return {
    ok: true,
    message: `${result.sent} message${result.sent === 1 ? "" : "s"} sent${result.skipped ? `, ${result.skipped} couldn't be reached` : ""}. Anyone held by quiet hours goes if you press it again in the morning.`,
  };
}

/** Close a collections or low-rating item. */
export async function settleAutomationException(id: string, state: "resolved" | "dismissed"): Promise<ActionResult> {
  const who = await owner();
  if ("error" in who) return { ok: false, message: who.error ?? "Not allowed." };
  const sb = untyped(await createClient());
  const { error } = await sb
    .from("client_automation_exceptions")
    .update({ state, resolved_at: new Date().toISOString(), resolved_by: who.profile.id })
    .eq("id", id)
    .eq("organization_id", who.profile.organization_id);
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: state === "resolved" ? "Done." : "Dismissed." };
}

/**
 * One tap on an answered call: what the client said. Goes through the call
 * list's own recorder, so "went elsewhere" and "do not call" close the job
 * the same way, then the call is marked filed.
 */
export async function fileCallOutcome(input: { callId: string; outcome: string; note?: string }): Promise<ActionResult> {
  const profile = await getRealProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !hasRole(profile.roles, "account-manager")) return { ok: false, message: "Only an owner or account manager can file calls." };
  if (!isCallOutcome(input.outcome)) return { ok: false, message: "Pick what they said." };

  const sb = untyped(await createClient());
  const { data } = await sb.from("voice_calls").select("id, proposal_id, disposition").eq("id", input.callId).maybeSingle();
  const call = data as { id: string; proposal_id: string | null; disposition: string | null } | null;
  if (!call?.proposal_id) return { ok: false, message: "That call isn't about a proposal." };
  if (call.disposition) return { ok: true, message: "Already filed." };

  const result = await recordProposalCall({ proposalId: call.proposal_id, outcome: input.outcome, note: input.note ?? "Logged from the phone line." });
  if (!result.ok) return result;
  const { data: latest } = await sb
    .from("proposal_calls")
    .select("id")
    .eq("proposal_id", call.proposal_id)
    .order("created_at", { ascending: false })
    .limit(1);
  await sb
    .from("voice_calls")
    .update({ disposition: input.outcome, disposition_at: new Date().toISOString(), disposition_by: profile.id, proposal_call_id: (latest ?? [])[0]?.id ?? null })
    .eq("id", call.id);
  refresh();
  return result;
}

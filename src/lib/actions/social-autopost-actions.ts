"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { refuseInDemo } from "@/lib/demo-mode";
import { isOwnerLevel } from "@/lib/roles";
import { outboundBaseUrl } from "@/lib/base-url";
import { describeDbError, isMissingColumn, isMissingTable } from "@/lib/setup-errors";
import { cadenceProblems, tidyCadence, type CadenceSlot } from "@/lib/social/cadence";
import { SEED_DRAFTS, seedCta, seedSlot } from "@/lib/social/seed-drafts";

/**
 * Admin › Social: the posting cadence, loading the starter drafts, and
 * trying a failed post again. Nothing here publishes: drafts wait for
 * approval, and the posting job sends approved posts on their slots.
 */

export type AutopostResult = { ok: true; message: string } | { ok: false; message: string };

const NEEDS_MIGRATION = "Apply migration 0374_social_autopost.sql first.";

async function owner(): Promise<{ id: string; organizationId: string } | { refused: string }> {
  await refuseInDemo();
  const profile = await getCurrentProfile();
  if (!profile) return { refused: "Sign in first." };
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) return { refused: "Only an owner or admin can change posting." };
  return { id: profile.id, organizationId: profile.organization_id };
}

function revalidate() {
  revalidatePath("/admin/social");
  revalidatePath("/marketing");
}

/** Posts a week per account and the best-time slots. */
export async function saveSocialCadence(input: { facebookPerWeek: number; instagramPerWeek: number; slots: CadenceSlot[]; autofill: boolean }): Promise<AutopostResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const cadence = tidyCadence({ facebook_per_week: input.facebookPerWeek, instagram_per_week: input.instagramPerWeek, slots: input.slots, autofill: input.autofill });
  const problems = cadenceProblems(cadence);
  if (problems.length) return { ok: false, message: problems.join(" ") };
  const sb = (await createClient()) as unknown as SupabaseClient;
  const { error } = await sb.from("social_cadence").upsert(
    {
      organization_id: who.organizationId,
      facebook_per_week: cadence.perWeek.facebook,
      instagram_per_week: cadence.perWeek.instagram,
      slots: cadence.slots,
      autofill: cadence.autofill,
      updated_by: who.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" }
  );
  if (isMissingTable(error)) return { ok: false, message: NEEDS_MIGRATION };
  if (error) return { ok: false, message: describeDbError(error) };
  revalidate();
  return { ok: true, message: `Saved: ${cadence.perWeek.facebook} a week on Facebook, ${cadence.perWeek.instagram} on Instagram.` };
}

/**
 * The twelve starter posts (lib/social/seed-drafts.ts) as drafts in the week
 * plan. Each one once: a draft already loaded is left as it is, edits and all.
 */
export async function loadStarterDrafts(): Promise<AutopostResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const sb = (await createClient()) as unknown as SupabaseClient;
  const { data: existing, error } = await sb.from("social_posts").select("seed_key").eq("organization_id", who.organizationId).not("seed_key", "is", null);
  if (isMissingColumn(error)) return { ok: false, message: NEEDS_MIGRATION };
  if (error) return { ok: false, message: describeDbError(error) };
  const have = new Set(((existing ?? []) as { seed_key: string }[]).map((r) => r.seed_key));
  const link = `${(await outboundBaseUrl()).replace(/\/$/, "")}/book`;
  const now = Date.now();
  const rows = SEED_DRAFTS.filter((s) => !have.has(s.key)).map((s) => {
    const slot = seedSlot(s);
    return {
      organization_id: who.organizationId,
      seed_key: s.key,
      job_id: s.photo?.jobId ?? null,
      after_photo_id: s.photo?.afterPhotoId ?? null,
      kind: s.kind,
      hook: s.hook,
      body: s.body,
      cta: seedCta(s, link),
      hashtags: s.hashtags,
      card_style: s.cardStyle,
      placement: "page",
      platforms: s.platforms,
      photo_hint: s.photoHint,
      plan_day: s.day,
      status: "draft",
      // Its suggested slot, kept on approval while still ahead.
      scheduled_for: slot.getTime() > now ? slot.toISOString() : null,
    };
  });
  if (!rows.length) return { ok: true, message: "The starter posts are already loaded." };
  const { error: insertError } = await sb.from("social_posts").insert(rows);
  if (insertError) return { ok: false, message: describeDbError(insertError) };
  revalidate();
  return { ok: true, message: `Loaded ${rows.length} draft${rows.length === 1 ? "" : "s"}. Approve them in the week plan; nothing goes out until you do.` };
}

/** A failed post back into the queue: a fresh slot from the scheduler, tries reset. */
export async function retrySocialPost(id: string): Promise<AutopostResult> {
  const who = await owner();
  if ("refused" in who) return { ok: false, message: who.refused };
  const sb = (await createClient()) as unknown as SupabaseClient;
  const { error } = await sb
    .from("social_posts")
    .update({ status: "approved", scheduled_for: null, attempts: 0, next_attempt_at: null, last_error: null, channel: null, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", who.organizationId)
    .eq("status", "failed");
  if (isMissingColumn(error)) return { ok: false, message: NEEDS_MIGRATION };
  if (error) return { ok: false, message: describeDbError(error) };
  revalidate();
  return { ok: true, message: "Back in the queue: it gets the next free slot on the next run." };
}

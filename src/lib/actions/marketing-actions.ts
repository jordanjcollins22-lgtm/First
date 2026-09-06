"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { designsAvailable } from "@/lib/actions/house-coverage-actions";
import { createEddmMailing } from "@/lib/actions/eddm-mailing-actions";
import { flyerRoutesOf, shortAddress, type MarketingPlay, type PlayStatus } from "@/lib/marketing-plays";
import { learnedDefaults, type PlayReview } from "@/lib/marketing-approval";

/**
 * Ticking marketing off.
 *
 * The one thing a person does here is say a play happened. Hangers ticked
 * off are recorded on every door they went to, with the design each door
 * was due, so the house cards and the next print run know without anyone
 * typing an address. A flyers play can also have its EDDM mailing made,
 * priced at today's rates, from the routes the play already chose.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PAGES = ["/my-day", "/attractors"];

async function guard<T>(name: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[marketing] ${name} failed:`, err);
    const e = err as { message?: string; details?: string };
    return { ok: false, error: [e?.message, e?.details].filter(Boolean).join(" ") || String(err) };
  }
}

async function requireUser() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  return profile;
}

export async function setMarketingPlayStatus(playId: string, status: PlayStatus): Promise<ActionResult<{ recorded: number }>> {
  return guard("setMarketingPlayStatus", async () => {
    const profile = await requireUser();
    const supabase = await createClient();
    const { data: play, error: readError } = await supabase.from("marketing_plays").select("organization_id").eq("id", playId).maybeSingle();
    if (readError) throw readError;
    if (!play || play.organization_id !== profile.organization_id) throw new Error("No such play.");
    const { data, error } = await supabase.rpc("marketing_play_set", {
      the_play: playId,
      new_status: status,
      by: profile.id,
      designs: await designsAvailable(),
    });
    if (error) throw error;
    const result = (data ?? {}) as { ok?: boolean; recorded?: number };
    if (!result.ok) throw new Error("The play could not be updated.");
    for (const page of PAGES) revalidatePath(page);
    return { recorded: result.recorded ?? 0 };
  });
}

/** The EDDM mailing for a flyers play, from the routes the play chose. */
export async function makeFlyerMailing(playId: string): Promise<ActionResult<{ mailingId: string }>> {
  return guard("makeFlyerMailing", async () => {
    const profile = await requireUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("marketing_plays_list", { org: profile.organization_id, include_done: true });
    if (error) throw error;
    const play = ((Array.isArray(data) ? data : []) as unknown as MarketingPlay[]).find((p) => p.id === playId);
    if (!play || play.kind !== "flyers") throw new Error("No such flyers play.");
    if (play.mailingId) return { mailingId: play.mailingId };
    const routes = flyerRoutesOf(play);
    if (routes.length === 0) throw new Error("No USPS route reaches this house, so there is nothing to mail.");

    const made = await createEddmMailing({
      name: `Flyers round ${shortAddress(play.address)}`,
      audience: "residential",
      routes: routes.map((r) => ({ zip: r.zip, routeId: r.routeId, residential: r.residential, business: r.business, total: r.total, facility: r.facility })),
    });
    if (!made.ok) throw new Error(made.error);
    const { error: linkError } = await supabase
      .from("marketing_plays")
      .update({ mailing_id: made.value.id, updated_at: new Date().toISOString() })
      .eq("id", playId);
    if (linkError) throw linkError;
    for (const page of PAGES) revalidatePath(page);
    return { mailingId: made.value.id };
  });
}

/**
 * What the business has taught the app, written where the sync reads it:
 * the count it settles on for each kind, and how far a hanger is worth
 * carrying. Recomputed from every decision so far after each new one.
 */
async function relearn(org: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("marketing_approval_state", { org });
  if (error) throw error;
  const reviews = ((data ?? {}) as { reviews?: PlayReview[] }).reviews ?? [];
  for (const d of learnedDefaults(reviews)) {
    const { error: setError } = await supabase.rpc("marketing_defaults_set", { org, the_kind: d.kind, the_quantity: d.quantity, the_reach: d.maxDistanceM });
    if (setError) throw setError;
  }
}

/** A person's yes to a play as it stands. */
export async function approveMarketingPlay(playId: string): Promise<ActionResult<null>> {
  return guard("approveMarketingPlay", async () => {
    const profile = await requireUser();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("marketing_play_review", { org: profile.organization_id, the_play: playId, decision: "approve", by: profile.id });
    if (error) throw error;
    const result = (data ?? {}) as { ok?: boolean; error?: string };
    if (!result.ok) throw new Error(result.error ?? "The play could not be approved.");
    await relearn(profile.organization_id);
    for (const page of PAGES) revalidatePath(page);
    return null;
  });
}

/**
 * A person's changes to a play: doors (or routes) taken out, how many it
 * should be, and a word on why. Approved in the same breath when asked,
 * so one look is one click.
 */
export async function editMarketingPlay(input: { playId: string; remove?: string[]; quantity?: number | null; note?: string; approve?: boolean }): Promise<ActionResult<{ quantity: number }>> {
  return guard("editMarketingPlay", async () => {
    const profile = await requireUser();
    const supabase = await createClient();
    const org = profile.organization_id;
    const { data, error } = await supabase.rpc("marketing_play_review", {
      org,
      the_play: input.playId,
      decision: "edit",
      remove: input.remove && input.remove.length > 0 ? input.remove : null,
      set_quantity: input.quantity ?? null,
      note: input.note?.trim() || null,
      by: profile.id,
    });
    if (error) throw error;
    const result = (data ?? {}) as { ok?: boolean; error?: string; quantity?: number };
    if (!result.ok) throw new Error(result.error ?? "The play could not be changed.");
    if (input.approve) {
      const { data: approved, error: approveError } = await supabase.rpc("marketing_play_review", { org, the_play: input.playId, decision: "approve", by: profile.id });
      if (approveError) throw approveError;
      const ok = (approved ?? {}) as { ok?: boolean; error?: string };
      if (!ok.ok) throw new Error(ok.error ?? "The play could not be approved.");
    }
    await relearn(org);
    for (const page of PAGES) revalidatePath(page);
    return { quantity: result.quantity ?? 0 };
  });
}

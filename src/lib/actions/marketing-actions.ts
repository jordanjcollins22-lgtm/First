"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { designsAvailable } from "@/lib/actions/house-coverage-actions";
import { createEddmMailing } from "@/lib/actions/eddm-mailing-actions";
import { flyerRoutesOf, shortAddress, type MarketingPlay, type PlayStatus } from "@/lib/marketing-plays";

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

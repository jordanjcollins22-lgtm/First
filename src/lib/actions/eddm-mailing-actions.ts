"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getEddmRates } from "@/lib/data/eddm";
import { mailingSummary, piecesFor, type Audience, type MailingRoute } from "@/lib/eddm-mailing";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Saving a mailing and the rates it is priced at.
 *
 * A mailing is saved before its order package is printed, so the package
 * and the record agree and the rates it was priced at are kept with it: a
 * mailing priced in March should still say what it cost in March after USPS
 * changes the rate in July.
 *
 * Returned, not thrown: a thrown server error reaches a production browser
 * as React error #441 with the message stripped.
 */

export type ActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

const PAGE = "/attractors";

async function guard<T>(name: string, work: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (err) {
    console.error(`[eddm-mailing] ${name} failed:`, err);
    const e = err as { message?: string; details?: string; code?: string };
    return { ok: false, error: [e?.message, e?.details, e?.code ? `(${e.code})` : null].filter(Boolean).join(" ") || String(err) };
  }
}

async function requireUser() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Not signed in.");
  return profile;
}

/** The rates every new mailing is priced at. Dollars per piece. */
export async function updateEddmRates(input: { postagePerPiece: number | null; printCostPerPiece: number }): Promise<ActionResult<null>> {
  return guard("updateEddmRates", async () => {
    const profile = await requireUser();
    const postage = input.postagePerPiece == null || Number.isNaN(input.postagePerPiece) ? null : Math.max(0, input.postagePerPiece);
    const print = Number.isFinite(input.printCostPerPiece) ? Math.max(0, input.printCostPerPiece) : 0;
    if (postage != null && postage > 5) throw new Error("That postage rate is per piece, in dollars. It should be well under a dollar.");

    const supabase = await createClient();
    const { error } = await supabase
      .from("organizations")
      .update({ eddm_postage_per_piece: postage, eddm_print_cost_per_piece: print })
      .eq("id", profile.organization_id);
    if (error) throw error;
    revalidatePath(PAGE);
    return null;
  });
}

export interface CreateMailingInput {
  name: string;
  audience: Audience;
  routes: MailingRoute[];
}

/** A mailing, priced at today's rates and saved with them. */
export async function createEddmMailing(input: CreateMailingInput): Promise<ActionResult<{ id: string }>> {
  return guard("createEddmMailing", async () => {
    const profile = await requireUser();
    if (input.routes.length === 0) throw new Error("Pick at least one route.");
    const name = input.name.trim() || "EDDM mailing";
    const audience: Audience = input.audience === "all" ? "all" : "residential";

    const rates = await getEddmRates();
    const summary = mailingSummary(input.routes, audience, rates);

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("eddm_mailings")
      .insert({
        organization_id: profile.organization_id,
        name,
        audience,
        routes: input.routes.map((r) => ({ ...r, pieces: piecesFor(r, audience) })) as unknown as Json,
        pieces: summary.pieces,
        postage_per_piece: rates.postagePerPiece,
        print_cost_per_piece: rates.printCostPerPiece,
        postage_cents: summary.postageCents ?? 0,
        print_cost_cents: summary.printCents,
        drop_facilities: summary.facilities as unknown as Json,
        status: "planned",
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (error) throw error;
    revalidatePath(PAGE);
    return { id: data.id };
  });
}

/** planned -> printed -> mailed, with the date it went out. */
export async function setEddmMailingStatus(
  id: string,
  status: "planned" | "printed" | "mailed",
  mailedOn?: string | null
): Promise<ActionResult<null>> {
  return guard("setEddmMailingStatus", async () => {
    await requireUser();
    const supabase = await createClient();
    const { error } = await supabase
      .from("eddm_mailings")
      .update({
        status,
        mailed_on: status === "mailed" ? (mailedOn ?? new Date().toISOString().slice(0, 10)) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) throw error;
    revalidatePath(PAGE);
    return null;
  });
}

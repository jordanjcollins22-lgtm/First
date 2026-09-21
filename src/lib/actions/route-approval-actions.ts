"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { isOwnerLevel } from "@/lib/roles";
import { createEddmMailing } from "@/lib/actions/eddm-mailing-actions";
import { addMarketingPlayDoors, approveMarketingPlay, editMarketingPlay, setMarketingPlayOrder, setMarketingPlayStatus } from "@/lib/actions/marketing-actions";
import { routeName } from "@/lib/route-approval";
import type { Point } from "@/lib/route-order";
import type { Json } from "@/lib/supabase/database.types";

export type RouteActionResult = { ok: true; message: string; orderId?: string } | { ok: false; message: string };

const PAGES = ["/my-day", "/attractors", "/marketing"];

async function allowed() {
  const profile = await getCurrentProfile();
  if (!profile) throw new Error("Sign in first.");
  if (!isOwnerLevel(profile.roles) && !profile.roles.includes("admin")) throw new Error("Only an owner or admin approves routes.");
  return profile;
}

async function run(work: () => Promise<{ message: string; orderId?: string }>): Promise<RouteActionResult> {
  try {
    const out = await work();
    for (const page of PAGES) revalidatePath(page);
    return { ok: true, ...out };
  } catch (err) {
    console.error("[route approval]", err);
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Yes to the USPS route: the mailing exists from this moment, this route only. */
export async function approveUspsRoute(input: {
  eddmRouteId: string;
  houseIds: string[];
}): Promise<RouteActionResult> {
  return run(async () => {
    const profile = await allowed();
    const supabase = await createClient();
    const { data: route } = await supabase
      .from("eddm_routes")
      .select("id, zip, route_id, residential_count, business_count, total_count, attributes")
      .eq("id", input.eddmRouteId)
      .maybeSingle();
    if (!route) throw new Error("That route is gone.");
    const attributes = (route.attributes ?? {}) as Record<string, unknown>;
    const facility = [attributes.FAC_NAME, attributes.FACILITY_NAME, attributes.FACILITY].find((v) => typeof v === "string" && v.trim()) as string | undefined;

    // Only this route. Whole routes are how EDDM is sold, and the one the
    // house is on is the one whose neighbours saw the van.
    const made = await createEddmMailing({
      name: routeName({ routeId: route.route_id, zip: route.zip }),
      audience: "residential",
      routes: [
        {
          zip: route.zip,
          routeId: route.route_id,
          residential: route.residential_count,
          business: route.business_count,
          total: route.total_count,
          facility: facility ?? null,
        },
      ],
    });
    if (!made.ok) throw new Error(made.error);

    const now = new Date().toISOString();
    const { data: order, error } = await supabase
      .from("route_orders")
      .upsert(
        {
          organization_id: profile.organization_id,
          eddm_route_id: route.id,
          status: "draw",
          house_ids: input.houseIds,
          mailing_id: made.value.id,
          usps_approved_at: now,
          usps_approved_by: profile.id,
          updated_at: now,
        },
        { onConflict: "organization_id,eddm_route_id" }
      )
      .select("id")
      .single();
    if (error) throw error;
    return { message: "Route approved. Now draw the door hanger route over it.", orderId: order.id };
  });
}

/** No to the USPS route. The evaluations on it are left alone; the route is not asked about again. */
export async function skipUspsRoute(input: { eddmRouteId: string; houseIds: string[]; note?: string }): Promise<RouteActionResult> {
  return run(async () => {
    const profile = await allowed();
    const supabase = await createClient();
    const now = new Date().toISOString();
    const { error } = await supabase.from("route_orders").upsert(
      {
        organization_id: profile.organization_id,
        eddm_route_id: input.eddmRouteId,
        status: "skipped",
        house_ids: input.houseIds,
        note: input.note?.trim() || null,
        updated_at: now,
      },
      { onConflict: "organization_id,eddm_route_id" }
    );
    if (error) throw error;
    return { message: "Skipped. On to the next route." };
  });
}

/**
 * The line drawn, as the round's doors in walking order.
 *
 * Doors on the round that the line does not reach come off; doors the line
 * reaches that were not on it go on; the order is the line's. Any other
 * evaluation's round on this route is folded into this one, so a route is
 * walked once.
 */
export async function saveDoorHangerLine(input: {
  eddmRouteId: string;
  playId: string;
  order: string[];
  line: Point[];
  otherPlayIds: string[];
}): Promise<RouteActionResult> {
  return run(async () => {
    const profile = await allowed();
    if (input.order.length === 0) throw new Error("The line reaches no doors. Draw it along the houses.");
    const supabase = await createClient();
    const { data: play } = await supabase.from("marketing_plays").select("id, targets").eq("id", input.playId).maybeSingle();
    if (!play) throw new Error("That round is gone.");
    const current = new Set((Array.isArray(play.targets) ? play.targets : []).filter((t): t is string => typeof t === "string"));
    const wanted = new Set(input.order);

    const remove = [...current].filter((id) => !wanted.has(id));
    const add = input.order.filter((id) => !current.has(id));
    if (add.length > 0) {
      const added = await addMarketingPlayDoors(input.playId, add);
      if (!added.ok) throw new Error(added.error);
    }
    if (remove.length > 0) {
      const edited = await editMarketingPlay({ playId: input.playId, remove, note: "Drawn over the USPS route." });
      if (!edited.ok) throw new Error(edited.error);
    }
    const ordered = await setMarketingPlayOrder({ playId: input.playId, order: input.order, line: input.line });
    if (!ordered.ok) throw new Error(ordered.error);

    for (const other of input.otherPlayIds) {
      if (other === input.playId) continue;
      await setMarketingPlayStatus(other, "skipped");
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from("route_orders")
      .update({ status: "hangers", play_id: input.playId, updated_at: now })
      .eq("organization_id", profile.organization_id)
      .eq("eddm_route_id", input.eddmRouteId);
    if (error) throw error;
    return { message: `${input.order.length} doors on the round.` };
  });
}

export async function backToDrawing(input: { eddmRouteId: string }): Promise<RouteActionResult> {
  return run(async () => {
    const profile = await allowed();
    const supabase = await createClient();
    const { error } = await supabase
      .from("route_orders")
      .update({ status: "draw", updated_at: new Date().toISOString() })
      .eq("organization_id", profile.organization_id)
      .eq("eddm_route_id", input.eddmRouteId);
    if (error) throw error;
    return { message: "Draw it again." };
  });
}

/** Yes to the hangers as drawn. The round is approved and lands on the walker's day. */
export async function confirmDoorHangers(input: { eddmRouteId: string; playId: string }): Promise<RouteActionResult> {
  return run(async () => {
    const profile = await allowed();
    const approved = await approveMarketingPlay(input.playId);
    if (!approved.ok) throw new Error(approved.error);
    const supabase = await createClient();
    const { error } = await supabase
      .from("route_orders")
      .update({ status: "submit", updated_at: new Date().toISOString() })
      .eq("organization_id", profile.organization_id)
      .eq("eddm_route_id", input.eddmRouteId);
    if (error) throw error;
    return { message: "Hangers confirmed. Pick the days and submit." };
  });
}

/** The days, and the order. */
export async function submitRouteOrder(input: { eddmRouteId: string; walkOn: string; mailOn: string }): Promise<RouteActionResult> {
  return run(async () => {
    const profile = await allowed();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.walkOn) || !/^\d{4}-\d{2}-\d{2}$/.test(input.mailOn)) throw new Error("Pick both days.");
    const supabase = await createClient();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("route_orders")
      .update({ status: "ordered", walk_on: input.walkOn, mail_on: input.mailOn, submitted_at: now, submitted_by: profile.id, updated_at: now })
      .eq("organization_id", profile.organization_id)
      .eq("eddm_route_id", input.eddmRouteId)
      .select("id, mailing_id")
      .single();
    if (error) throw error;
    // The mailing is printed as part of this order.
    if (data.mailing_id) {
      await supabase.from("eddm_mailings").update({ status: "printed", updated_at: now }).eq("id", data.mailing_id);
    }
    return { message: "Submitted. The order is ready to print.", orderId: data.id };
  });
}

/** Kept so a typed line survives a reload while drawing. */
export type SavedLine = Json;

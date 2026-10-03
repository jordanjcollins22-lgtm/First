"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/data/team";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getCrewDay, localDayKey } from "@/lib/data/crew-day";
import { readDay } from "@/lib/crew-day";
import { clockIn } from "@/lib/actions/time-clock-actions";
import { myOpenEntry } from "@/lib/data/time-clock";
import { describeDbError } from "@/lib/setup-errors";
import type { LoadoutKind } from "@/lib/loadout";
import type { ShopStage } from "@/lib/shop-flow";

export type ShopResult = { ok: true } | { ok: false; message: string };

const KINDS: LoadoutKind[] = ["kit", "tool", "material"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refresh() {
  revalidatePath("/my-day");
  revalidatePath("/today");
}

/**
 * "I'm at the shop." One tap that does three things: says they are here,
 * starts their clock, and, for the lead, opens the day's shop screen.
 */
export async function arriveAtShop(input: { openDay: boolean }): Promise<ShopResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    const day = localDayKey();
    const organizationId = await getCurrentOrganizationId();
    const supabase = await createClient();

    // Their own arrival, once. The day board reads the same log, so this is
    // the same tap as the board's first button.
    const mine = await getCrewDay(day).catch(() => null);
    const already = mine ? readDay(mine.events, mine.stops).phase !== "before_shop" : false;
    if (!already) {
      const { error } = await supabase.from("crew_day_events").insert({
        organization_id: organizationId,
        profile_id: profile.id,
        day,
        kind: "arrived_shop",
        job_id: null,
      });
      if (error) return { ok: false, message: describeDbError(error) };
    }

    // Their time starts now, unless it already has.
    const open = await myOpenEntry(profile.id).catch(() => null);
    if (!open) await clockIn(null, "At the shop").catch(() => null);

    if (input.openDay) {
      const { error } = await supabase
        .from("crew_shop_days")
        .upsert({ organization_id: organizationId, day, lead_profile_id: profile.id }, { onConflict: "organization_id,day", ignoreDuplicates: true });
      if (error) return { ok: false, message: describeDbError(error) };
    }

    refresh();
    return { ok: true };
  } catch (err) {
    console.error("arriveAtShop failed:", err);
    return { ok: false, message: "Couldn't record that." };
  }
}

/** A tick on the shared list. Whoever grabbed it, it is on the truck for everybody. */
export async function tickShopItem(input: { shopDayId: string; kind: LoadoutKind; key: string; checked: boolean }): Promise<ShopResult> {
  try {
    const profile = await getCurrentProfile();
    if (!profile) return { ok: false, message: "Sign in first." };
    if (!UUID_RE.test(input.shopDayId) || !KINDS.includes(input.kind) || !input.key) return { ok: false, message: "That is not on the list." };
    const supabase = await createClient();
    if (input.checked) {
      const organizationId = await getCurrentOrganizationId();
      const { error } = await supabase
        .from("crew_shop_checks")
        .upsert({ shop_day_id: input.shopDayId, organization_id: organizationId, item_kind: input.kind, item_key: input.key, checked_by: profile.id }, { onConflict: "shop_day_id,item_kind,item_key" });
      if (error) return { ok: false, message: describeDbError(error) };
    } else {
      const { error } = await supabase.from("crew_shop_checks").delete().eq("shop_day_id", input.shopDayId).eq("item_kind", input.kind).eq("item_key", input.key);
      if (error) return { ok: false, message: describeDbError(error) };
    }
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("tickShopItem failed:", err);
    return { ok: false, message: "Couldn't tick that." };
  }
}

async function leadOnly(shopDayId: string): Promise<{ ok: true; supabase: Awaited<ReturnType<typeof createClient>> } | { ok: false; message: string }> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, message: "Sign in first." };
  if (!UUID_RE.test(shopDayId)) return { ok: false, message: "No shop day open." };
  const supabase = await createClient();
  const { data } = await supabase.from("crew_shop_days").select("lead_profile_id").eq("id", shopDayId).maybeSingle();
  if (!data) return { ok: false, message: "No shop day open." };
  const office = profile.roles.some((r) => r === "owner" || r === "admin" || r === "project-lead");
  if (data.lead_profile_id !== profile.id && !office) return { ok: false, message: "Only the lead moves the screen on." };
  return { ok: true, supabase };
}

/** Which page of the load-out is up. The lead's call. */
export async function setShopPage(input: { shopDayId: string; pageIndex: number }): Promise<ShopResult> {
  try {
    const gate = await leadOnly(input.shopDayId);
    if (!gate.ok) return gate;
    const page = Math.max(0, Math.floor(input.pageIndex));
    const { error } = await gate.supabase.from("crew_shop_days").update({ page_index: page, updated_at: new Date().toISOString() }).eq("id", input.shopDayId);
    if (error) return { ok: false, message: describeDbError(error) };
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("setShopPage failed:", err);
    return { ok: false, message: "Couldn't turn the page." };
  }
}

/** Loading done; on to the maps. Or back, if something was missed. */
export async function setShopStage(input: { shopDayId: string; stage: ShopStage }): Promise<ShopResult> {
  try {
    const gate = await leadOnly(input.shopDayId);
    if (!gate.ok) return gate;
    if (!["loadout", "maps"].includes(input.stage)) return { ok: false, message: "Use the road button for that." };
    const patch: { stage: ShopStage; updated_at: string; loadout_done_at?: string } = { stage: input.stage, updated_at: new Date().toISOString() };
    if (input.stage === "maps") patch.loadout_done_at = new Date().toISOString();
    const { error } = await gate.supabase.from("crew_shop_days").update(patch).eq("id", input.shopDayId);
    if (error) return { ok: false, message: describeDbError(error) };
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("setShopStage failed:", err);
    return { ok: false, message: "Couldn't move on." };
  }
}

/** The stops the lead wants on everybody's screen right now. */
export async function setShownJobs(input: { shopDayId: string; jobIds: string[] }): Promise<ShopResult> {
  try {
    const gate = await leadOnly(input.shopDayId);
    if (!gate.ok) return gate;
    const ids = input.jobIds.filter((id) => UUID_RE.test(id)).slice(0, 20);
    const { error } = await gate.supabase.from("crew_shop_days").update({ shown_job_ids: ids, updated_at: new Date().toISOString() }).eq("id", input.shopDayId);
    if (error) return { ok: false, message: describeDbError(error) };
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("setShownJobs failed:", err);
    return { ok: false, message: "Couldn't change what's showing." };
  }
}

/**
 * "Head to the first project."
 *
 * Everybody who tapped in at the shop leaves it and is on the way to the
 * first stop, in one press from the tablet, so five people do not each tap
 * two buttons in the yard. Somebody who never tapped in is left alone; their
 * own phone still lets them catch up.
 */
export async function headOut(input: { shopDayId: string; firstJobId: string }): Promise<ShopResult> {
  try {
    const gate = await leadOnly(input.shopDayId);
    if (!gate.ok) return gate;
    if (!UUID_RE.test(input.firstJobId)) return { ok: false, message: "Pick the first stop." };
    const supabase = gate.supabase;
    const organizationId = await getCurrentOrganizationId();
    const day = localDayKey();

    const [{ data: crewRows }, { data: eventRows }] = await Promise.all([
      supabase.from("job_crew").select("profile_id").eq("job_id", input.firstJobId),
      supabase.from("crew_day_events").select("profile_id, kind").eq("day", day),
    ]);
    const onJob = new Set(((crewRows ?? []) as { profile_id: string }[]).map((r) => r.profile_id));
    const byPerson = new Map<string, Set<string>>();
    for (const e of (eventRows ?? []) as { profile_id: string; kind: string }[]) {
      const set = byPerson.get(e.profile_id) ?? new Set<string>();
      set.add(e.kind);
      byPerson.set(e.profile_id, set);
    }
    const now = Date.now();
    const rows: { organization_id: string; profile_id: string; day: string; kind: string; job_id: string | null; at: string }[] = [];
    for (const profileId of onJob) {
      const kinds = byPerson.get(profileId);
      if (!kinds?.has("arrived_shop") || kinds.has("left_shop")) continue;
      rows.push({ organization_id: organizationId, profile_id: profileId, day, kind: "left_shop", job_id: null, at: new Date(now).toISOString() });
      rows.push({ organization_id: organizationId, profile_id: profileId, day, kind: "travelling", job_id: input.firstJobId, at: new Date(now + 1000).toISOString() });
    }
    if (rows.length > 0) {
      const { error } = await supabase.from("crew_day_events").insert(rows);
      if (error) return { ok: false, message: describeDbError(error) };
    }
    const { error } = await supabase
      .from("crew_shop_days")
      .update({ stage: "en_route", en_route_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", input.shopDayId);
    if (error) return { ok: false, message: describeDbError(error) };
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("headOut failed:", err);
    return { ok: false, message: "Couldn't send everybody out." };
  }
}

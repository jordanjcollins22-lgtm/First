import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { createClient } from "@/lib/supabase/server";
import { getWorkOrderForJob } from "@/lib/data/work-order";
import { buildLoadout, type Loadout, type LoadoutCheck, type LoadoutContainer, type LoadoutSession, type LoadoutTool } from "@/lib/loadout";
import type { ShopStage } from "@/lib/shop-flow";
import type { ProposalSiteImageTransform } from "@/types/domain";
import type { WorkOrderZone } from "@/lib/work-order";

export interface ShopDay {
  id: string;
  day: string;
  stage: ShopStage;
  pageIndex: number;
  shownJobIds: string[];
  leadProfileId: string;
  leadName: string;
  clockedInAt: string;
  checks: LoadoutCheck[];
  /** Who ticked what, by "kind:key". */
  checkedBy: Record<string, string>;
}

/** The business's shop screen for the day, if the lead has opened it. */
export async function getShopDay(day: string): Promise<ShopDay | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("crew_shop_days")
    .select("id, day, stage, page_index, shown_job_ids, lead_profile_id, clocked_in_at, lead:profiles!crew_shop_days_lead_profile_id_fkey(full_name, email)")
    .eq("day", day)
    .maybeSingle();
  if (!data) return null;
  const row = data as unknown as {
    id: string;
    day: string;
    stage: string;
    page_index: number;
    shown_job_ids: string[] | null;
    lead_profile_id: string;
    clocked_in_at: string;
    lead: { full_name: string | null; email: string } | null;
  };
  const { data: checkRows } = await supabase
    .from("crew_shop_checks")
    .select("item_kind, item_key, checked_by, profiles:checked_by(full_name)")
    .eq("shop_day_id", row.id);
  const checks: LoadoutCheck[] = [];
  const checkedBy: Record<string, string> = {};
  for (const c of (checkRows ?? []) as unknown as { item_kind: string; item_key: string; profiles: { full_name: string | null } | null }[]) {
    checks.push({ kind: c.item_kind as LoadoutCheck["kind"], key: c.item_key });
    if (c.profiles?.full_name) checkedBy[`${c.item_kind}:${c.item_key}`] = c.profiles.full_name.split(" ")[0];
  }
  return {
    id: row.id,
    day: row.day,
    stage: row.stage as ShopStage,
    pageIndex: row.page_index,
    shownJobIds: row.shown_job_ids ?? [],
    leadProfileId: row.lead_profile_id,
    leadName: row.lead?.full_name || row.lead?.email || "The lead",
    clockedInAt: row.clocked_in_at,
    checks,
    checkedBy,
  };
}

/**
 * The whole day's load-out, for the whole crew.
 *
 * Everything every stop today needs, whoever is on it. The shop is loaded
 * once, as a team, so the list is the day's and not one person's.
 */
export async function getDayLoadout(day: string, checks: LoadoutCheck[]): Promise<Loadout> {
  const supabase = await createClient();
  const [{ data: sessionRows }, { data: toolRows }, { data: containerRows }] = await Promise.all([
    supabase
      .from("job_work_sessions")
      .select("id, job_id, kits, tool_ids, materials, jobs(status, properties(address, customers(name)))")
      .lte("starts_on", day)
      .gte("ends_on", day)
      .not("status", "in", "(cancelled,done)")
      // Our crew's load-out; a subcontractor's pickup is on their own sheet.
      .is("subcontractor_id", null),
    supabase.from("tools").select("id, name, kits, active"),
    supabase.from("kit_containers").select("name, kits, code").is("archived_at", null),
  ]);
  type Row = { id: string; job_id: string; kits: number[] | null; tool_ids: string[] | null; materials: string[] | null; jobs: { status: string; properties: { address: string; customers: { name: string } | null } | null } | null };
  const sessions: LoadoutSession[] = ((sessionRows ?? []) as unknown as Row[])
    .filter((r) => r.jobs && r.jobs.status !== "cancelled" && r.jobs.status !== "completed")
    .map((r) => ({
      sessionId: r.id,
      jobId: r.job_id,
      customerName: r.jobs?.properties?.customers?.name ?? "Client",
      address: r.jobs?.properties?.address ?? "",
      kits: r.kits ?? [],
      toolIds: r.tool_ids ?? [],
      materials: r.materials ?? [],
    }));
  const tools: LoadoutTool[] = ((toolRows ?? []) as { id: string; name: string; kits: number[] | null; active: boolean }[]).map((t) => ({
    id: t.id,
    name: t.active ? t.name : `${t.name} (marked inactive in inventory)`,
    kits: t.active ? (t.kits ?? []) : [],
  }));
  const containers: LoadoutContainer[] = ((containerRows ?? []) as { name: string; kits: number[] | null; code?: string | null }[]).map((c) => ({
    name: c.name,
    kits: c.kits ?? [],
    code: c.code ?? null,
  }));
  return buildLoadout(sessions, tools, containers, checks);
}

export interface SiteMapCard {
  jobId: string;
  customerName: string;
  address: string;
  siteImagePath: string | null;
  imageTransform: ProposalSiteImageTransform | null;
  zones: WorkOrderZone[];
}

/** The site maps the lead is going over, in the order asked for. */
export async function getSiteMaps(jobIds: string[]): Promise<SiteMapCard[]> {
  const cards = await Promise.all(
    jobIds.map(async (jobId) => {
      const order = await getWorkOrderForJob(jobId).catch(() => null);
      if (!order) return null;
      return {
        jobId,
        customerName: order.customerName,
        address: order.address,
        siteImagePath: order.siteImagePath,
        imageTransform: order.imageTransform,
        zones: order.order.zones,
      } satisfies SiteMapCard;
    })
  );
  return cards.filter((c): c is SiteMapCard => c !== null);
}

/** Who has tapped "I'm at the shop" today, by first name. */
export async function whoIsAtTheShop(day: string): Promise<{ profileId: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("crew_day_events")
    .select("profile_id, profiles:profile_id(full_name, email)")
    .eq("day", day)
    .eq("kind", "arrived_shop");
  const seen = new Map<string, string>();
  for (const r of (data ?? []) as unknown as { profile_id: string; profiles: { full_name: string | null; email: string } | null }[]) {
    if (!seen.has(r.profile_id)) seen.set(r.profile_id, (r.profiles?.full_name || r.profiles?.email || "Someone").split(" ")[0]);
  }
  return [...seen.entries()].map(([profileId, name]) => ({ profileId, name }));
}

/** When the crew is due at the shop, and the codes that get them in. */
export async function getShopInfo(): Promise<{ arriveBy: string | null; accessCodes: string | null; address: string | null }> {
  const supabase = await createClient();
  const organizationId = await getCurrentOrganizationId();
  const [{ data: org }, { data: places }] = await Promise.all([
    supabase.from("organizations").select("shop_arrival_time").eq("id", organizationId).maybeSingle(),
    supabase.from("business_locations").select("name, address, access_codes"),
  ]);
  const home = (places ?? []).find((p) => /shop/i.test(p.name)) ?? (places ?? [])[0] ?? null;
  return { arriveBy: org?.shop_arrival_time ?? null, accessCodes: home?.access_codes ?? null, address: home?.address ?? null };
}

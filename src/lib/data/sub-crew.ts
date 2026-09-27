import { createAdminClient } from "@/lib/supabase/admin";
import { buildWorkOrder, type WorkOrderZone } from "@/lib/work-order";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { areaState, type AreaState, type SubProgress } from "@/lib/sub-crew";
import type { WorkZone } from "@/components/canvas/types";

export interface SubCrewSheet {
  token: string;
  jobId: string;
  sessionId: string;
  businessName: string;
  subcontractorName: string;
  usesOurTools: boolean;
  startsOn: string;
  endsOn: string;
  purpose: string | null;
  address: string;
  lat: number | null;
  lng: number | null;
  clientFirstName: string | null;
  accountManager: { name: string; phone: string | null } | null;
  progress: SubProgress;
  /** Only when they use our tools: where to pick up, when, how to get in, and which kits. */
  shop: { address: string | null; arriveBy: string | null; accessCodes: string | null } | null;
  kits: { number: number; container: string | null; code: string | null }[];
  zones: WorkOrderZone[];
  areaStates: Record<string, AreaState>;
  /** The account manager's walkthrough: waiting, approved, or sent back with what to fix. */
  walkthrough: { status: "requested" | "approved" | "rejected"; notes: string | null } | null;
}

/**
 * A subcontractor's crew sheet, by the token in their link. Read with the
 * service key: they have no login, and the token is the whole of their
 * access, to this one visit and nothing else.
 */
export async function getSubCrewSheet(token: string): Promise<SubCrewSheet | null> {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const admin = createAdminClient();
  const { data: session } = await admin
    .from("job_work_sessions")
    .select("id, job_id, organization_id, starts_on, ends_on, purpose, kits, subcontractor_id, sub_picked_up_at, sub_on_way_at, sub_arrived_at, sub_finished_at, status")
    .eq("crew_token", token)
    .maybeSingle();
  if (!session || !session.subcontractor_id || session.status === "cancelled") return null;

  const [{ data: sub }, { data: job }, { data: org }, { data: design }, { data: photos }, { data: services }, { data: walks }] = await Promise.all([
    admin.from("subcontractors").select("name, uses_our_tools").eq("id", session.subcontractor_id).maybeSingle(),
    admin
      .from("jobs")
      .select("id, property:properties(address, lat, lng, customer:customers(name, account_manager_id))")
      .eq("id", session.job_id)
      .maybeSingle(),
    admin.from("organizations").select("name, shop_arrival_time").eq("id", session.organization_id).maybeSingle(),
    admin.from("canvas_designs").select("zones").eq("job_id", session.job_id).maybeSingle(),
    admin.from("job_photos").select("kind, zone_id").eq("job_id", session.job_id),
    admin.from("services").select("service_type_id, name").eq("organization_id", session.organization_id),
    admin.from("job_walkthroughs").select("status, review_notes, created_at").eq("job_id", session.job_id).order("created_at", { ascending: false }).limit(1),
  ]);
  if (!sub || !job) return null;

  const property = (job as unknown as {
    property: { address: string | null; lat: number | null; lng: number | null; customer: { name: string | null; account_manager_id: string | null } | null } | null;
  }).property;
  const managerId = property?.customer?.account_manager_id ?? null;
  const manager = managerId ? (await admin.from("profiles").select("full_name, phone").eq("id", managerId).maybeSingle()).data : null;

  const zones = ((design?.zones ?? []) as unknown as WorkZone[]).filter((z) => z.service);
  const order = buildWorkOrder(zones, { servicePricing: (services ?? []) as never }, (typeId, key) => serviceTypeById(typeId)?.fields?.find((f) => f.key === key)?.label ?? key);
  const kindsByZone = new Map<string, string[]>();
  for (const p of photos ?? []) {
    if (!p.zone_id) continue;
    kindsByZone.set(p.zone_id, [...(kindsByZone.get(p.zone_id) ?? []), p.kind]);
  }

  let shop: SubCrewSheet["shop"] = null;
  let kits: SubCrewSheet["kits"] = [];
  if (sub.uses_our_tools) {
    const [{ data: places }, { data: containers }] = await Promise.all([
      admin.from("business_locations").select("name, address, access_codes").eq("organization_id", session.organization_id),
      admin.from("kit_containers").select("name, kits, code").eq("organization_id", session.organization_id).is("archived_at", null),
    ]);
    const home = (places ?? []).find((p) => /shop/i.test(p.name)) ?? (places ?? [])[0] ?? null;
    shop = { address: home?.address ?? null, arriveBy: org?.shop_arrival_time ?? null, accessCodes: home?.access_codes ?? null };
    kits = ((session.kits ?? []) as number[]).map((number) => {
      const box = (containers ?? []).find((c) => ((c.kits ?? []) as number[]).includes(number));
      return { number, container: box?.name ?? null, code: box?.code ?? null };
    });
  }

  const walk = (walks ?? [])[0];
  return {
    token,
    jobId: session.job_id,
    sessionId: session.id,
    businessName: org?.name ?? "",
    subcontractorName: sub.name,
    usesOurTools: sub.uses_our_tools,
    startsOn: session.starts_on,
    endsOn: session.ends_on,
    purpose: session.purpose,
    address: property?.address ?? "",
    lat: property?.lat ?? null,
    lng: property?.lng ?? null,
    clientFirstName: property?.customer?.name?.trim().split(/\s+/)[0] ?? null,
    accountManager: manager ? { name: manager.full_name ?? "The account manager", phone: manager.phone ?? null } : null,
    progress: {
      usesOurTools: sub.uses_our_tools,
      pickedUpAt: session.sub_picked_up_at,
      onWayAt: session.sub_on_way_at,
      arrivedAt: session.sub_arrived_at,
      finishedAt: session.sub_finished_at,
    },
    shop,
    kits,
    zones: order.zones,
    areaStates: Object.fromEntries(order.zones.map((z) => [z.id, areaState(kindsByZone.get(z.id) ?? [])])),
    walkthrough:
      walk && (walk.status === "requested" || walk.status === "approved" || walk.status === "rejected")
        ? { status: walk.status, notes: walk.review_notes ?? null }
        : null,
  };
}

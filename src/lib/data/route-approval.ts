import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getEddmMailing, type EddmMailing } from "@/lib/data/eddm";
import { listDoorHangerSlots } from "@/lib/data/door-hangers";
import { sheetsNeeded } from "@/lib/door-hanger";
import { pickRoute, type RouteHouse, type RouteOrderStatus, type RouteStep } from "@/lib/route-approval";
import type { LngLatPair } from "@/lib/eddm";
import type { MarketingPlay } from "@/lib/marketing-plays";
import type { Point } from "@/lib/route-order";

/**
 * The route to put in front of the owner next, with everything the four
 * questions need: the USPS outline and streets to draw, every house on it
 * to walk, the evaluated houses it was chosen for, the round as it stands,
 * and the mailing once there is one.
 */

export interface EvaluatedHouse {
  houseId: string;
  address: string;
  customerName: string | null;
  jobId: string | null;
  playId: string;
}

export interface RoundView {
  id: string;
  quantity: number;
  doorIds: string[];
  /** In walking order, when a person drew or tapped one. */
  order: string[] | null;
  line: Point[] | null;
  assignedToName: string | null;
  approved: boolean;
}

export interface RouteApprovalView {
  orderId: string | null;
  step: RouteStep;
  route: {
    id: string;
    zip: string;
    routeId: string;
    residential: number;
    business: number;
    total: number;
    facility: string | null;
    rings: LngLatPair[][];
    paths: LngLatPair[][];
  };
  houses: RouteHouse[];
  evaluated: EvaluatedHouse[];
  round: RoundView | null;
  mailing: EddmMailing | null;
  /** Sheets the hangers take through the printer, from the current design. Null with no design. */
  sheets: number | null;
  walkOn: string | null;
  mailOn: string | null;
}

interface PlayRow {
  id: string;
  house_id: string;
  quantity: number;
  targets: unknown;
  walk_order: unknown;
  walk_order_line: unknown;
  approval: string;
  assigned_to: string | null;
}

export async function nextRouteToApprove(): Promise<RouteApprovalView | null> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();

  // The evaluations with hangers still to do, and the route each house is on.
  const { data: listed } = await supabase.rpc("marketing_plays_list", { org, include_done: false });
  const plays = ((Array.isArray(listed) ? listed : []) as unknown as MarketingPlay[]).filter(
    (p) => p.kind === "door_hangers" && p.reason === "evaluation" && p.status === "open"
  );
  if (plays.length === 0) return null;

  const houseIds = [...new Set(plays.map((p) => p.houseId))];
  const [{ data: houseRows }, { data: orderRows }] = await Promise.all([
    supabase.from("houses").select("id, eddm_route_id").in("id", houseIds),
    supabase.from("route_orders").select("id, eddm_route_id, status, house_ids, mailing_id, play_id, walk_on, mail_on").eq("organization_id", org),
  ]);
  const routeOfHouse = new Map((houseRows ?? []).map((h) => [h.id, h.eddm_route_id]));
  const orderByRoute = new Map((orderRows ?? []).map((o) => [o.eddm_route_id, o]));

  const byRoute = new Map<string, { since: string; houseIds: string[] }>();
  for (const play of plays) {
    const routeId = routeOfHouse.get(play.houseId);
    if (!routeId) continue;
    const entry = byRoute.get(routeId) ?? { since: play.createdAt, houseIds: [] };
    entry.since = play.createdAt < entry.since ? play.createdAt : entry.since;
    entry.houseIds.push(play.houseId);
    byRoute.set(routeId, entry);
  }
  const candidates = [...byRoute.entries()].map(([eddmRouteId, entry]) => ({
    eddmRouteId,
    since: entry.since,
    houseIds: entry.houseIds,
    status: (orderByRoute.get(eddmRouteId)?.status ?? null) as RouteOrderStatus | null,
  }));
  const picked = pickRoute(candidates);
  if (!picked) return null;

  const order = orderByRoute.get(picked.eddmRouteId) ?? null;
  const step: RouteStep = order && order.status !== "ordered" && order.status !== "skipped" ? (order.status as RouteStep) : "usps";

  const [{ data: route }, { data: onRoute }, slots] = await Promise.all([
    supabase
      .from("eddm_routes")
      .select("id, zip, route_id, residential_count, business_count, total_count, attributes, rings, paths")
      .eq("id", picked.eddmRouteId)
      .maybeSingle(),
    supabase
      .from("houses")
      .select("id, address, lat, lng")
      .eq("eddm_route_id", picked.eddmRouteId)
      .eq("kind", "house")
      .eq("needs_review", false)
      .limit(3000),
    listDoorHangerSlots().catch(() => []),
  ]);
  if (!route) return null;

  const attributes = (route.attributes ?? {}) as Record<string, unknown>;
  const facility = [attributes.FAC_NAME, attributes.FACILITY_NAME, attributes.FACILITY].find((v) => typeof v === "string" && v.trim()) as string | undefined;

  // The round is the first evaluated house's play unless the order already
  // says which one carries the line.
  const roundPlayId = order?.play_id ?? plays.find((p) => picked.houseIds.includes(p.houseId))?.id ?? null;
  let round: RoundView | null = null;
  if (roundPlayId) {
    const { data: row } = await supabase
      .from("marketing_plays")
      .select("id, house_id, quantity, targets, walk_order, walk_order_line, approval, assigned_to")
      .eq("id", roundPlayId)
      .maybeSingle();
    const play = row as PlayRow | null;
    if (play) {
      const listedPlay = plays.find((p) => p.id === play.id);
      round = {
        id: play.id,
        quantity: play.quantity,
        doorIds: (Array.isArray(play.targets) ? play.targets : []).filter((t): t is string => typeof t === "string"),
        order: Array.isArray(play.walk_order) ? (play.walk_order as string[]) : null,
        line: Array.isArray(play.walk_order_line) ? (play.walk_order_line as Point[]) : null,
        assignedToName: listedPlay?.assignedToName ?? null,
        approved: play.approval === "approve" || play.approval === "approved" || play.approval === "auto",
      };
    }
  }

  const evaluated: EvaluatedHouse[] = plays
    .filter((p) => picked.houseIds.includes(p.houseId))
    .map((p) => ({ houseId: p.houseId, address: p.address, customerName: p.customerName, jobId: p.jobId, playId: p.id }));

  const mailing = order?.mailing_id ? await getEddmMailing(order.mailing_id).catch(() => null) : null;
  const doors = round ? (round.order?.length || round.doorIds.length) : 0;

  return {
    orderId: order?.id ?? null,
    step,
    route: {
      id: route.id,
      zip: route.zip,
      routeId: route.route_id,
      residential: route.residential_count ?? 0,
      business: route.business_count ?? 0,
      total: route.total_count ?? 0,
      facility: facility ?? null,
      rings: (Array.isArray(route.rings) ? route.rings : []) as LngLatPair[][],
      paths: (Array.isArray(route.paths) ? route.paths : []) as LngLatPair[][],
    },
    houses: (onRoute ?? []).map((h) => ({ id: h.id, address: h.address, lat: h.lat, lng: h.lng })),
    evaluated,
    round,
    mailing,
    sheets: doors > 0 ? sheetsNeeded(doors, slots) : null,
    walkOn: order?.walk_on ?? null,
    mailOn: order?.mail_on ?? null,
  };
}

/** One submitted order, for the printed page. */
export interface RouteOrderView {
  id: string;
  status: RouteOrderStatus;
  route: { zip: string; routeId: string; residential: number; total: number; facility: string | null };
  mailing: EddmMailing | null;
  round: { id: string; doors: { address: string }[]; assignedToName: string | null } | null;
  sheets: number | null;
  walkOn: string | null;
  mailOn: string | null;
  submittedAt: string | null;
  evaluated: { address: string; customerName: string | null }[];
}

export async function getRouteOrder(id: string): Promise<RouteOrderView | null> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const { data: order } = await supabase.from("route_orders").select("*").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!order) return null;

  const [{ data: route }, mailing, slots, { data: evaluatedRows }] = await Promise.all([
    supabase.from("eddm_routes").select("zip, route_id, residential_count, total_count, attributes").eq("id", order.eddm_route_id).maybeSingle(),
    order.mailing_id ? getEddmMailing(order.mailing_id).catch(() => null) : Promise.resolve(null),
    listDoorHangerSlots().catch(() => []),
    order.house_ids.length > 0
      ? supabase.from("houses").select("id, address, property:properties(customer:customers(name))").in("id", order.house_ids)
      : Promise.resolve({ data: [] }),
  ]);
  if (!route) return null;
  const attributes = (route.attributes ?? {}) as Record<string, unknown>;
  const facility = [attributes.FAC_NAME, attributes.FACILITY_NAME, attributes.FACILITY].find((v) => typeof v === "string" && v.trim()) as string | undefined;

  let round: RouteOrderView["round"] = null;
  if (order.play_id) {
    const { data: raw } = await supabase.rpc("marketing_play_route", { the_play: order.play_id });
    const playRoute = raw as { doors?: { address: string }[] } | null;
    const { data: listed } = await supabase.rpc("marketing_plays_list", { org, include_done: true });
    const play = ((Array.isArray(listed) ? listed : []) as unknown as MarketingPlay[]).find((p) => p.id === order.play_id);
    round = { id: order.play_id, doors: playRoute?.doors ?? [], assignedToName: play?.assignedToName ?? null };
  }

  return {
    id: order.id,
    status: order.status as RouteOrderStatus,
    route: { zip: route.zip, routeId: route.route_id, residential: route.residential_count ?? 0, total: route.total_count ?? 0, facility: facility ?? null },
    mailing,
    round,
    sheets: round && round.doors.length > 0 ? sheetsNeeded(round.doors.length, slots) : null,
    walkOn: order.walk_on,
    mailOn: order.mail_on,
    submittedAt: order.submitted_at,
    evaluated: ((evaluatedRows ?? []) as unknown as { address: string; property: { customer: { name: string } | null } | null }[]).map((h) => ({
      address: h.address,
      customerName: h.property?.customer?.name ?? null,
    })),
  };
}

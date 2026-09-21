import { createClient } from "@/lib/supabase/server";
import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { getEddmMailing, type EddmMailing } from "@/lib/data/eddm";
import { listDoorHangerSlots } from "@/lib/data/door-hangers";
import { sheetsNeeded } from "@/lib/door-hanger";
import { collectedByJob } from "@/lib/data/all-proposals";
import { paidInFull, pickRoute, type RouteHouse, type RouteOrderStatus, type RouteStep } from "@/lib/route-approval";
import type { LngLatPair } from "@/lib/eddm";
import type { MarketingPlay } from "@/lib/marketing-plays";
import type { Point } from "@/lib/route-order";

/**
 * The route to put in front of the owner next, with everything the four
 * questions need: the USPS outline and streets to draw, every house on it
 * to walk, the paid jobs it was chosen for, the round as it stands, and the
 * mailing once there is one.
 *
 * A route earns its place through a job that is finished and paid for.
 * Evaluations, jobs under way and jobs still owed on do not count.
 */

export interface AnchorHouse {
  houseId: string;
  address: string;
  customerName: string | null;
  jobId: string;
  /** The open door hanger round on the house, once there is one. */
  playId: string | null;
}

export interface RoundView {
  id: string;
  quantity: number;
  doorIds: string[];
  /** In walking order, when a person drew or tapped one. */
  order: string[] | null;
  line: Point[] | null;
  area: Point[] | null;
  parks: Point[];
  start: Point | null;
  end: Point | null;
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
  /** The paid, finished jobs the route was picked for. */
  anchors: AnchorHouse[];
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
  walk_area: unknown;
  park_points: unknown;
  start_point: unknown;
  end_point: unknown;
  approval: string;
  assigned_to: string | null;
}

interface PaidJob {
  jobId: string;
  propertyId: string;
  customerName: string | null;
  lat: number | null;
  lng: number | null;
  /** When the money was in, or failing that when the job closed. */
  paidOn: string;
}

interface AnchorRow extends PaidJob {
  houseId: string;
  address: string;
  eddmRouteId: string | null;
}

/** Jobs finished and paid in full, with where they are. */
async function paidCompletedJobs(supabase: Awaited<ReturnType<typeof createClient>>, org: string): Promise<PaidJob[]> {
  type Row = {
    id: string;
    property_id: string;
    completed_at: string | null;
    updated_at: string;
    property: { lat: number | null; lng: number | null; customer: { name: string | null; organization_id: string } | null } | null;
  };
  const { data: rows } = await supabase
    .from("jobs")
    .select("id, property_id, completed_at, updated_at, property:properties!inner(lat, lng, customer:customers!inner(name, organization_id))")
    .eq("property.customer.organization_id", org)
    .eq("status", "completed")
    .is("cancelled_at", null)
    .order("completed_at", { ascending: true, nullsFirst: false })
    .limit(500);
  const jobs = (rows ?? []) as unknown as Row[];
  if (jobs.length === 0) return [];
  const jobIds = jobs.map((j) => j.id);

  type Proposal = { job_id: string; total_cost: number | null; discount_amount: number | null; paid_at: string | null; responded_at: string | null };
  const [{ data: proposals }, collected] = await Promise.all([
    supabase
      .from("job_proposals")
      .select("job_id, total_cost, discount_amount, paid_at, responded_at")
      .in("job_id", jobIds)
      .in("status", ["accepted", "paid"])
      .order("responded_at", { ascending: false, nullsFirst: false }),
    collectedByJob(jobIds),
  ]);
  const accepted = new Map<string, Proposal>();
  for (const p of (proposals ?? []) as Proposal[]) if (!accepted.has(p.job_id)) accepted.set(p.job_id, p);

  const out: PaidJob[] = [];
  for (const job of jobs) {
    const proposal = accepted.get(job.id) ?? null;
    const paid = paidInFull({
      collectedCents: collected.get(job.id) ?? 0,
      priceCents: proposal?.total_cost == null ? null : Math.round(Number(proposal.total_cost) * 100),
      discountCents: Math.round(Number(proposal?.discount_amount ?? 0) * 100),
      paidAt: proposal?.paid_at ?? null,
    });
    if (!paid) continue;
    out.push({
      jobId: job.id,
      propertyId: job.property_id,
      customerName: job.property?.customer?.name ?? null,
      lat: job.property?.lat ?? null,
      lng: job.property?.lng ?? null,
      paidOn: proposal?.paid_at ?? job.completed_at ?? job.updated_at,
    });
  }
  return out;
}

/**
 * The county house for each job: the one linked to the property, or the
 * nearest one within 40 m of the pin when nothing has been linked yet.
 */
async function anchorHouses(supabase: Awaited<ReturnType<typeof createClient>>, jobs: PaidJob[]): Promise<AnchorRow[]> {
  if (jobs.length === 0) return [];
  type House = { id: string; address: string; lat: number; lng: number; eddm_route_id: string | null; property_id: string | null };
  const columns = "id, address, lat, lng, eddm_route_id, property_id";
  const { data: linkedRows } = await supabase
    .from("houses")
    .select(columns)
    .in("property_id", [...new Set(jobs.map((j) => j.propertyId))]);
  const linked = new Map<string, House>();
  for (const h of (linkedRows ?? []) as House[]) if (h.property_id && !linked.has(h.property_id)) linked.set(h.property_id, h);

  const out: AnchorRow[] = [];
  for (const job of jobs) {
    let house = linked.get(job.propertyId) ?? null;
    if (!house && job.lat != null && job.lng != null) {
      const { lat, lng } = job;
      const { data: near } = await supabase
        .from("houses")
        .select(columns)
        .eq("kind", "house")
        .gte("lat", lat - 0.0004)
        .lte("lat", lat + 0.0004)
        .gte("lng", lng - 0.0005)
        .lte("lng", lng + 0.0005)
        .limit(20);
      const best = ((near ?? []) as House[])
        .map((row) => ({ row, metres: Math.hypot((row.lat - lat) * 110_574, (row.lng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180)) }))
        .sort((a, b) => a.metres - b.metres)[0];
      house = best && best.metres <= 40 ? best.row : null;
    }
    if (!house) continue;
    out.push({ ...job, houseId: house.id, address: house.address, eddmRouteId: house.eddm_route_id });
  }
  return out;
}

export async function nextRouteToApprove(): Promise<RouteApprovalView | null> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();

  // The paid, finished jobs and the county house each sits in, alongside
  // the orders and the printer, which do not depend on them.
  const [anchors, { data: orderRows }, slots] = await Promise.all([
    paidCompletedJobs(supabase, org).then((jobs) => anchorHouses(supabase, jobs)),
    supabase.from("route_orders").select("id, eddm_route_id, status, house_ids, mailing_id, play_id, walk_on, mail_on").eq("organization_id", org),
    listDoorHangerSlots().catch(() => []),
  ]);
  if (anchors.length === 0) return null;
  const orderByRoute = new Map((orderRows ?? []).map((o) => [o.eddm_route_id, o]));

  const byRoute = new Map<string, { since: string; houseIds: string[] }>();
  for (const anchor of anchors) {
    if (!anchor.eddmRouteId) continue;
    const entry = byRoute.get(anchor.eddmRouteId) ?? { since: anchor.paidOn, houseIds: [] };
    entry.since = anchor.paidOn < entry.since ? anchor.paidOn : entry.since;
    if (!entry.houseIds.includes(anchor.houseId)) entry.houseIds.push(anchor.houseId);
    byRoute.set(anchor.eddmRouteId, entry);
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

  // The open door hanger round on each of this route's houses, whatever put
  // it there. Read for these houses only rather than every play in the
  // business, and in the same breath as the route and its doors.
  type OpenPlay = { id: string; house_id: string };
  const [{ data: route }, { data: onRoute }, { data: openPlays }, mailing] = await Promise.all([
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
    supabase
      .from("marketing_plays")
      .select("id, house_id")
      .eq("organization_id", org)
      .eq("kind", "door_hangers")
      .eq("status", "open")
      .in("house_id", picked.houseIds)
      .order("created_at", { ascending: true }),
    order?.mailing_id ? getEddmMailing(order.mailing_id).catch(() => null) : Promise.resolve(null),
  ]);
  if (!route) return null;

  const playOfHouse = new Map<string, { id: string }>();
  for (const p of (openPlays ?? []) as unknown as OpenPlay[]) {
    if (!playOfHouse.has(p.house_id)) playOfHouse.set(p.house_id, { id: p.id });
  }

  const attributes = (route.attributes ?? {}) as Record<string, unknown>;
  const facility = [attributes.FAC_NAME, attributes.FACILITY_NAME, attributes.FACILITY].find((v) => typeof v === "string" && v.trim()) as string | undefined;

  const seen = new Set<string>();
  const anchorViews: AnchorHouse[] = [];
  for (const a of anchors.filter((x) => picked.houseIds.includes(x.houseId))) {
    if (seen.has(a.houseId)) continue;
    seen.add(a.houseId);
    anchorViews.push({ houseId: a.houseId, address: a.address, customerName: a.customerName, jobId: a.jobId, playId: playOfHouse.get(a.houseId)?.id ?? null });
  }

  // The round is the first house's play unless the order already says
  // which one carries the line.
  const roundPlayId = order?.play_id ?? anchorViews.find((a) => a.playId)?.playId ?? null;
  let round: RoundView | null = null;
  if (roundPlayId) {
    const { data: row } = await supabase
      .from("marketing_plays")
      .select("id, house_id, quantity, targets, walk_order, walk_order_line, walk_area, park_points, start_point, end_point, approval, assigned_to")
      .eq("id", roundPlayId)
      .maybeSingle();
    const play = row as PlayRow | null;
    if (play) {
      const { data: walker } = play.assigned_to
        ? await supabase.from("profiles").select("full_name").eq("id", play.assigned_to).maybeSingle()
        : { data: null };
      round = {
        id: play.id,
        quantity: play.quantity,
        doorIds: (Array.isArray(play.targets) ? play.targets : []).filter((t): t is string => typeof t === "string"),
        order: Array.isArray(play.walk_order) ? (play.walk_order as string[]) : null,
        line: Array.isArray(play.walk_order_line) ? (play.walk_order_line as Point[]) : null,
        area: Array.isArray(play.walk_area) ? (play.walk_area as Point[]) : null,
        parks: Array.isArray(play.park_points) ? (play.park_points as Point[]) : [],
        start: isPoint(play.start_point) ? play.start_point : null,
        end: isPoint(play.end_point) ? play.end_point : null,
        assignedToName: walker?.full_name ?? null,
        approved: play.approval === "approve" || play.approval === "approved" || play.approval === "auto",
      };
    }
  }

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
    anchors: anchorViews,
    round,
    mailing,
    sheets: doors > 0 ? sheetsNeeded(doors, slots) : null,
    walkOn: order?.walk_on ?? null,
    mailOn: order?.mail_on ?? null,
  };
}

function isPoint(v: unknown): v is Point {
  return typeof v === "object" && v !== null && typeof (v as Point).lat === "number" && typeof (v as Point).lng === "number";
}

/** One submitted order, for the printed page. */
export interface RouteOrderView {
  id: string;
  status: RouteOrderStatus;
  route: { zip: string; routeId: string; residential: number; total: number; facility: string | null };
  mailing: EddmMailing | null;
  round: { id: string; doors: { address: string }[]; assignedToName: string | null; parks: Point[]; start: Point | null; end: Point | null } | null;
  sheets: number | null;
  walkOn: string | null;
  mailOn: string | null;
  submittedAt: string | null;
  /** The paid jobs the route was ordered round. */
  anchors: { address: string; customerName: string | null }[];
}

export async function getRouteOrder(id: string): Promise<RouteOrderView | null> {
  const supabase = await createClient();
  const org = await getCurrentOrganizationId();
  const { data: order } = await supabase.from("route_orders").select("*").eq("id", id).eq("organization_id", org).maybeSingle();
  if (!order) return null;

  const [{ data: route }, mailing, slots, { data: anchorRows }] = await Promise.all([
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
    const { data: pins } = await supabase.from("marketing_plays").select("park_points, start_point, end_point").eq("id", order.play_id).maybeSingle();
    round = {
      id: order.play_id,
      doors: playRoute?.doors ?? [],
      assignedToName: play?.assignedToName ?? null,
      parks: Array.isArray(pins?.park_points) ? (pins.park_points as Point[]) : [],
      start: isPoint(pins?.start_point) ? pins.start_point : null,
      end: isPoint(pins?.end_point) ? pins.end_point : null,
    };
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
    anchors: ((anchorRows ?? []) as unknown as { address: string; property: { customer: { name: string } | null } | null }[]).map((h) => ({
      address: h.address,
      customerName: h.property?.customer?.name ?? null,
    })),
  };
}

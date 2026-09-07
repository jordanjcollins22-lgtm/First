/**
 * The marketing that follows every evaluation and every new client.
 *
 * An evaluation means door hangers round the house. A new client means the
 * full set: a yard sign, five doors knocked, a hundred door hangers, a
 * thousand flyers. The database makes the plays and picks the doors and
 * routes; this says what each one is in words, groups them by house for
 * the list, and decides what a tick means. Pure, because it decides what
 * gets printed, walked and mailed.
 */

export type PlayKind = "yard_sign" | "knocks" | "door_hangers" | "flyers";
export type PlayReason = "evaluation" | "client" | "ramp";
export type PlayStatus = "open" | "done" | "skipped";

/** A USPS route as a flyers play carries it. */
export interface FlyerRoute {
  id: string;
  zip: string;
  routeId: string;
  residential: number | null;
  business: number | null;
  total: number | null;
  facility: string | null;
  pieces: number;
}

export interface MarketingPlay {
  id: string;
  houseId: string;
  address: string;
  lat: number;
  lng: number;
  jobId: string | null;
  customerId: string | null;
  customerName: string | null;
  reason: PlayReason;
  kind: PlayKind;
  quantity: number;
  zoneId: string | null;
  zoneName: string | null;
  zoneMode: string | null;
  /** Whether the zone has been approved for the map; null when the play has no zone. */
  zoneApproved?: boolean | null;
  /** pending until a person (or, with trust earned, the app) approves it. */
  approval?: "pending" | "approved" | "auto";
  approvedAt?: string | null;
  /** Doors or routes a person took out. */
  removedCount?: number;
  /** House ids for doors; FlyerRoute objects for flyers. */
  targets: unknown;
  status: PlayStatus;
  doneAt: string | null;
  doneBy: string | null;
  mailingId: string | null;
  createdAt: string;
  /** The doors, as addresses, for the knocks and the sign. */
  targetAddresses: string[] | null;
}

/** The order the set is done in: the sign goes up first, the mail goes last. */
export const KIND_ORDER: PlayKind[] = ["yard_sign", "knocks", "door_hangers", "flyers"];

export const KIND_LABEL: Record<PlayKind, string> = {
  yard_sign: "Yard sign",
  knocks: "Knock on doors",
  door_hangers: "Door hangers",
  flyers: "Flyers by mail",
};

export const REASON_LABEL: Record<PlayReason, string> = {
  evaluation: "Evaluation",
  client: "New client",
  ramp: "Ramp",
};

/** The recipe, for the panel to say what happens on its own. */
export const RECIPE: Record<PlayReason, string> = {
  evaluation: "100 door hangers in the house's zone",
  client: "a yard sign, 5 doors knocked, 100 door hangers, 1,000 flyers by EDDM",
  ramp: "what the pulse asked for, on the cheapest levers, round the most recent evaluations and clients",
};

/** "1259 Collier Lane" from the geocoder's full line. */
export function shortAddress(address: string): string {
  return address.split(",")[0].trim() || address;
}

function splitNumber(address: string): { number: string | null; street: string } {
  const short = shortAddress(address);
  const m = /^(\d+[A-Za-z]?)\s+(.+)$/.exec(short);
  return m ? { number: m[1], street: m[2] } : { number: null, street: short };
}

/**
 * "206, 209, 207 and 211 Crafton Road and 301 Wakefield Drive".
 *
 * Doors on one street read as a run of numbers, which is how somebody
 * standing on that street thinks of them.
 */
export function compressAddresses(addresses: string[]): string {
  const runs: { street: string; numbers: string[] }[] = [];
  for (const address of addresses) {
    const { number, street } = splitNumber(address);
    const last = runs[runs.length - 1];
    if (last && last.street === street && number) last.numbers.push(number);
    else runs.push({ street, numbers: number ? [number] : [] });
  }
  const parts = runs.map((run) => (run.numbers.length === 0 ? run.street : `${joinList(run.numbers)} ${run.street}`));
  return joinList(parts);
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function flyerRoutesOf(play: MarketingPlay): FlyerRoute[] {
  if (play.kind !== "flyers" || !Array.isArray(play.targets)) return [];
  return (play.targets as Partial<FlyerRoute>[])
    .filter((r) => typeof r?.routeId === "string" && typeof r?.zip === "string")
    .map((r) => ({
      id: String(r.id ?? ""),
      zip: r.zip as string,
      routeId: r.routeId as string,
      residential: r.residential ?? null,
      business: r.business ?? null,
      total: r.total ?? null,
      facility: r.facility ?? null,
      pieces: Number(r.pieces ?? r.residential ?? 0),
    }));
}

export function houseTargetsOf(play: MarketingPlay): string[] {
  if (play.kind === "flyers" || !Array.isArray(play.targets)) return [];
  return (play.targets as unknown[]).filter((t): t is string => typeof t === "string");
}

/** "Knock on 5 doors", "100 door hangers", "1,016 flyers by mail". */
export function playTitle(play: MarketingPlay): string {
  const n = play.quantity.toLocaleString();
  switch (play.kind) {
    case "yard_sign":
      return "Put up the yard sign";
    case "knocks":
      return `Knock on ${n} door${play.quantity === 1 ? "" : "s"}`;
    case "door_hangers":
      return `${n} door hangers`;
    case "flyers":
      return `${n} flyers by mail`;
  }
}

/** Where exactly, in one line. */
export function playDetail(play: MarketingPlay): string {
  switch (play.kind) {
    case "yard_sign":
      return `At ${shortAddress(play.address)}.`;
    case "knocks":
      return play.targetAddresses && play.targetAddresses.length > 0
        ? `Next door each way and across the street: ${compressAddresses(play.targetAddresses)}.`
        : "No neighbours close enough to knock on.";
    case "door_hangers":
      return play.zoneName
        ? `The ${play.quantity} doors nearest the house in zone ${play.zoneName}${play.zoneApproved === false ? " (zone waiting for approval)" : ""}. Ticking this off records a hanger on each.`
        : `The ${play.quantity} doors nearest the house. Ticking this off records a hanger on each.`;
    case "flyers": {
      const routes = flyerRoutesOf(play);
      if (routes.length === 0) return "No USPS route reaches this house.";
      const byZip = new Map<string, string[]>();
      for (const r of routes) byZip.set(r.zip, [...(byZip.get(r.zip) ?? []), `${r.routeId} (${r.pieces.toLocaleString()})`]);
      const list = [...byZip.entries()].map(([zip, ids]) => `${zip} ${ids.join(", ")}`).join("; ");
      const facilities = [...new Set(routes.map((r) => r.facility).filter((f): f is string => !!f))];
      return `USPS routes ${list}${facilities.length > 0 ? `, dropped at ${facilities.join(" and ")}` : ""}.`;
    }
  }
}

export interface PlayGroup {
  houseId: string;
  address: string;
  customerName: string | null;
  jobId: string | null;
  /** The stronger reason, when a house has both. */
  reason: PlayReason;
  zoneId: string | null;
  zoneName: string | null;
  lat: number;
  lng: number;
  plays: MarketingPlay[];
  open: number;
  /** When the newest play was made. */
  since: string;
}

/**
 * The plays by house, the houses with something still to do first, newest
 * first. Within a house the set reads in the order it is done.
 */
export function groupPlays(plays: MarketingPlay[]): PlayGroup[] {
  const byHouse = new Map<string, PlayGroup>();
  for (const play of plays) {
    const group = byHouse.get(play.houseId) ?? {
      houseId: play.houseId,
      address: play.address,
      customerName: play.customerName,
      jobId: play.jobId,
      reason: play.reason,
      zoneId: play.zoneId,
      zoneName: play.zoneName,
      lat: play.lat,
      lng: play.lng,
      plays: [],
      open: 0,
      since: play.createdAt,
    };
    group.plays.push(play);
    if (play.status === "open") group.open++;
    if (play.reason === "client") group.reason = "client";
    if (!group.customerName && play.customerName) group.customerName = play.customerName;
    if (!group.jobId && play.jobId) group.jobId = play.jobId;
    if (play.createdAt > group.since) group.since = play.createdAt;
    byHouse.set(play.houseId, group);
  }
  const groups = [...byHouse.values()];
  for (const group of groups) {
    group.plays.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.createdAt.localeCompare(b.createdAt));
  }
  groups.sort((a, b) => Number(b.open > 0) - Number(a.open > 0) || b.since.localeCompare(a.since));
  return groups;
}

export interface PlaySummary {
  open: number;
  done: number;
  /** Doors still to hang, across every open hangers play. */
  hangersToGo: number;
  flyersToGo: number;
}

export function summarizePlays(plays: MarketingPlay[]): PlaySummary {
  const summary: PlaySummary = { open: 0, done: 0, hangersToGo: 0, flyersToGo: 0 };
  for (const play of plays) {
    if (play.status === "done") summary.done++;
    if (play.status !== "open") continue;
    summary.open++;
    if (play.kind === "door_hangers") summary.hangersToGo += play.quantity;
    if (play.kind === "flyers") summary.flyersToGo += play.quantity;
  }
  return summary;
}

/** What the panel says under its title. */
export function describePlays(summary: PlaySummary): string {
  if (summary.open === 0) {
    return summary.done > 0
      ? `Everything is out. ${summary.done} play${summary.done === 1 ? "" : "s"} done; the next evaluation or client adds more on its own.`
      : "Nothing yet. Every evaluation and every new client adds its marketing here on its own.";
  }
  const parts = [`${summary.open} to do`];
  if (summary.hangersToGo > 0) parts.push(`${summary.hangersToGo.toLocaleString()} hangers to hang`);
  if (summary.flyersToGo > 0) parts.push(`${summary.flyersToGo.toLocaleString()} flyers to mail`);
  return `${parts.join(", ")}.`;
}

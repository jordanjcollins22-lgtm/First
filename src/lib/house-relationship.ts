/**
 * How far a house has got with us, worked out from what happened to it.
 *
 * The state is never stored. It is the high-water mark of an event log, which
 * is the only version of this that survives contact with a real customer
 * history: somebody who paid us in 2024 and said no in 2026 is still a former
 * client, and a field that got overwritten to "spoken to" would have thrown
 * that away. Events are facts and cannot be untrue later; a status column is a
 * guess about which fact mattered most, made once, in the past.
 *
 * The county gives us the house. Our own activity gradually enriches it, and
 * nearly every house starts with no events at all -- that is the normal case
 * and the point of the exercise. Ninety thousand untouched houses is not
 * missing data, it is the map of where the work is.
 */

/**
 * What can happen to a house, weakest first.
 *
 * The order is the whole ranking. Adding a kind means deciding where it sits
 * in this list and nothing else.
 */
export const RELATIONSHIP_STAGES = [
  "untouched",
  "spoken_to",
  "evaluation",
  "proposal",
  "client",
  "job_completed",
] as const;

export type RelationshipStage = (typeof RELATIONSHIP_STAGES)[number];

/** Every kind of event except the absence of one. */
export type EventKind = Exclude<RelationshipStage, "untouched">;

export interface HouseEvent {
  kind: EventKind;
  /** ISO timestamp. */
  at: string;
}

const RANK = new Map<RelationshipStage, number>(
  RELATIONSHIP_STAGES.map((stage, index) => [stage, index])
);

export function rankOf(stage: RelationshipStage): number {
  return RANK.get(stage) ?? 0;
}

/**
 * What the marker shows: the furthest this house has ever got.
 *
 * Highest achieved rather than most recent, deliberately. A client who
 * declined this spring is still worth more on a map than a stranger, and
 * showing them as "spoken to" would send somebody to knock on the door of a
 * house that has already paid us twice.
 */
export function displayStage(events: HouseEvent[]): RelationshipStage {
  return events.reduce<RelationshipStage>(
    (best, event) => (rankOf(event.kind) > rankOf(best) ? event.kind : best),
    "untouched"
  );
}

/** The most recent thing that happened, which is a different question. */
export function latestEvent(events: HouseEvent[]): HouseEvent | null {
  return events.reduce<HouseEvent | null>(
    (latest, event) => (!latest || event.at > latest.at ? event : latest),
    null
  );
}

/**
 * Whether the story has gone backwards.
 *
 * True when the last thing to happen is weaker than the best thing that ever
 * did -- a former client who declined, a warm lead gone cold. Worth surfacing
 * because it is the difference between a house to knock on and a house to
 * ring, and the marker alone cannot say it.
 */
export function hasCooled(events: HouseEvent[]): boolean {
  const latest = latestEvent(events);
  if (!latest) return false;
  return rankOf(latest.kind) < rankOf(displayStage(events));
}

export interface ZoneStats {
  houses: number;
  /** Houses by the furthest they have got. Every house appears exactly once. */
  byStage: Record<RelationshipStage, number>;
  /** Houses that have reached client or beyond. */
  clients: number;
  /** Reached us but not yet bought: spoken to, evaluated or quoted. */
  engaged: number;
  untouched: number;
  /**
   * Clients as a percentage of the houses in the zone.
   *
   * The number that decides where to walk next: a court where two of
   * thirty-two have bought is a different prospect to one where none have.
   */
  densityPercent: number;
}

const EMPTY_BY_STAGE = (): Record<RelationshipStage, number> => ({
  untouched: 0,
  spoken_to: 0,
  evaluation: 0,
  proposal: 0,
  client: 0,
  job_completed: 0,
});

/**
 * What a zone looks like at a glance.
 *
 * Takes each house's events rather than each house's state, so there is no way
 * for a caller to pass a stale status in.
 */
export function zoneStats(houses: HouseEvent[][]): ZoneStats {
  const byStage = EMPTY_BY_STAGE();
  for (const events of houses) byStage[displayStage(events)]++;

  const clients = byStage.client + byStage.job_completed;
  const engaged = byStage.spoken_to + byStage.evaluation + byStage.proposal;

  return {
    houses: houses.length,
    byStage,
    clients,
    engaged,
    untouched: byStage.untouched,
    densityPercent:
      houses.length === 0 ? 0 : Math.round((clients / houses.length) * 10000) / 100,
  };
}

/** How a stage reads on screen. */
export const STAGE_LABEL: Record<RelationshipStage, string> = {
  untouched: "Not spoken to",
  spoken_to: "Spoken to",
  evaluation: "Evaluated",
  proposal: "Quoted",
  client: "Client",
  job_completed: "Work completed",
};

/**
 * Marker colours, chosen to be told apart as small dots on a satellite photo
 * rather than to look pleasant in a legend. Untouched is deliberately the
 * quietest: on a map of ninety thousand houses, the handful worth acting on
 * should be the ones the eye lands on.
 */
export const STAGE_COLOR: Record<RelationshipStage, string> = {
  untouched: "#94a3b8",
  spoken_to: "#facc15",
  evaluation: "#fb923c",
  proposal: "#38bdf8",
  client: "#22c55e",
  job_completed: "#15803d",
};

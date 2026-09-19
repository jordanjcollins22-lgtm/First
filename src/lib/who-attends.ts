/**
 * Who will actually be standing on the client's property.
 *
 * The proposal answered this with a flat "our own crew, not subcontractors",
 * which is true of most of the work and a lie about the rest. Some services
 * go to a local business we partner with, and somebody deciding whether to
 * let strangers onto their property is entitled to know which before they
 * agree rather than when a truck they do not recognise pulls up.
 *
 * So the answer is composed from the services actually on this proposal. It
 * names the partner, because the name on the truck is the thing the client
 * will be looking at.
 *
 * And it says the policy out loud even on a job that is entirely ours: work
 * we do not do in house is given to a licensed partner we hire, rather than
 * attempted by us. A client comparing quotes is trying to work out who is
 * going to have a go at something they are not set up for, and "we do all of
 * it ourselves" is the answer that should worry them.
 */

export type PerformedBy = "own" | "partner";

/** One service on the proposal, as far as who turns up is concerned. */
export interface CrewingLine {
  serviceLabel: string;
  performedBy: PerformedBy;
  /** The partner's trading name. Null even on a partner line if nobody set it. */
  partnerName?: string | null;
}

export type CrewingKind =
  /** Everything on this proposal is ours. */
  | "own"
  /** All of it goes to partners. */
  | "partner"
  /** Some ours, some theirs. */
  | "mixed"
  /** Nothing priced yet, so there is nothing to say. */
  | "none";

export interface Crewing {
  kind: CrewingKind;
  /** Service names we are doing ourselves, in the order they appear. */
  ownServices: string[];
  /** Partner name to the services they are doing. */
  partnerServices: { partner: string; services: string[] }[];
}

/** Any partner line with no name set. A truck with no name on the proposal. */
const UNNAMED_PARTNER = "A licensed local business we work with";

/**
 * Group the proposal's services by who does them.
 *
 * Duplicate service names collapse: a proposal with mulch in four zones is
 * still one thing the client is being told about, and listing it four times
 * reads like a mistake.
 */
export function summariseCrewing(lines: CrewingLine[]): Crewing {
  const own: string[] = [];
  const byPartner = new Map<string, string[]>();

  for (const line of lines) {
    const label = line.serviceLabel.trim();
    if (!label) continue;

    if (line.performedBy === "partner") {
      const partner = line.partnerName?.trim() || UNNAMED_PARTNER;
      const list = byPartner.get(partner) ?? [];
      if (!list.includes(label)) list.push(label);
      byPartner.set(partner, list);
    } else if (!own.includes(label)) {
      own.push(label);
    }
  }

  const partnerServices = [...byPartner.entries()].map(([partner, services]) => ({
    partner,
    services,
  }));

  const kind: CrewingKind =
    own.length === 0 && partnerServices.length === 0
      ? "none"
      : partnerServices.length === 0
        ? "own"
        : own.length === 0
          ? "partner"
          : "mixed";

  return { kind, ownServices: own, partnerServices };
}

/** "a, b and c" — the way somebody would say a list out loud. */
export function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The paragraph a client reads under "Who will be at my property?".
 *
 * Written for the case that is actually true of their proposal. A client
 * whose whole job is ours should not be reading a paragraph hedging about
 * partners, and a client whose tree work is going out should not be told we
 * never use anybody else.
 */
export function whoAttendsAnswer(crewing: Crewing): string {
  const OURS =
    "Our own crew, in company shirts and a marked truck. You will know the day before who is coming and roughly what time.";
  // Said on every proposal, including the ones that are entirely ours. It is
  // how we work, not a caveat about this particular job, and a client is
  // owed it before they decide rather than after somebody turns up.
  const POLICY =
    "Anything in your plan that is not something we do in house, we do not have a go at. We hire a licensed and insured partner who does that work every day, and we stay responsible for it either way.";
  const EITHER_WAY =
    "If you would like to be home for it we will work around that, and if you would rather not be, that is fine too. We will send you photos when it is done.";

  if (crewing.kind === "none" || crewing.kind === "own") {
    return `${OURS} ${POLICY} ${EITHER_WAY}`;
  }

  const partners = crewing.partnerServices.map(
    (p) => `${p.partner} will be doing the ${joinList(p.services).toLowerCase()}`
  );

  const HIRED =
    "licensed and insured, and we hire them for the work we do not do in house rather than attempting it ourselves";

  if (crewing.kind === "partner") {
    return (
      `${joinList(partners)}. They are a local business we have worked alongside for years, ${HIRED}. ` +
      `We stay responsible for the job either way, so anything you need still comes through us. ` +
      EITHER_WAY
    );
  }

  return (
    `Most of it is our own crew, in company shirts and a marked truck: the ${joinList(
      crewing.ownServices
    ).toLowerCase()}. ${joinList(partners)}. They are a local business we work with, ${HIRED}. ` +
    `We stay responsible for the whole job, so anything you need still comes through us. ` +
    EITHER_WAY
  );
}

/** True when a client is going to see somebody else's truck. */
export function involvesPartner(crewing: Crewing): boolean {
  return crewing.kind === "partner" || crewing.kind === "mixed";
}

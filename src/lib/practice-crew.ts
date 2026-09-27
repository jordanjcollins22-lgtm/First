/**
 * The sample job's crew side, for the crew preview on The system: the same
 * three areas as the sample site map, proposal and crew sheet, at the
 * stages our crew and a subcontractor go through, built with the same
 * functions the real screens use.
 */

import { buildLoadout, type Loadout } from "@/lib/loadout";
import { stepsFor, tipsFor, type AreaState } from "@/lib/area-work";
import type { AreaBoardData } from "@/lib/data/area-board";
import type { ShopDay } from "@/lib/data/shop-flow";
import type { SubCrewSheet } from "@/lib/data/sub-crew";
import type { CrewEvent, Stop } from "@/lib/crew-day";
import type { AreaState as SubAreaState } from "@/lib/sub-crew";
import type { JobWalkthrough } from "@/types/domain";
import type { SiteMapData } from "@/components/proposal/price-site-map";
import type { JobReceipt } from "@/lib/data/job-receipts";
import { PRACTICE_ADDRESS, PRACTICE_ZONES, practiceWorkOrder } from "@/lib/practice-sample";

export const SAMPLE_JOB_ID = "sample";
const ME = "me";

export const SAMPLE_SHOP = { arriveBy: "07:00:00", accessCodes: "Gate 1234, side door 5678", address: "The shop" };

export function sampleZones() {
  return practiceWorkOrder().zones;
}

export const SAMPLE_STOPS: Stop[] = [
  { jobId: SAMPLE_JOB_ID, sessionId: "visit", address: PRACTICE_ADDRESS, customerName: "Sarah Miller", lat: null, lng: null, purpose: null },
];

/** Our crew's day so far: at the shop, then left it, then on the way. */
export function sampleEvents(upTo: "at_shop" | "left_shop" | "travelling"): CrewEvent[] {
  const at = (h: number) => new Date(new Date().setHours(h, 0, 0, 0)).toISOString();
  const all: CrewEvent[] = [
    { kind: "arrived_shop", jobId: null, at: at(7) },
    { kind: "left_shop", jobId: null, at: at(7.5) },
    { kind: "travelling", jobId: SAMPLE_JOB_ID, at: at(7.6) },
  ];
  return all.slice(0, upTo === "at_shop" ? 1 : upTo === "left_shop" ? 2 : 3);
}

export function sampleLoadout(): Loadout {
  return buildLoadout(
    [{ sessionId: "visit", jobId: SAMPLE_JOB_ID, customerName: "Sarah Miller", address: PRACTICE_ADDRESS, kits: [2, 3], toolIds: [], materials: ["Black mulch"] }],
    [
      { id: "t1", name: "Flat shovel", kits: [2] },
      { id: "t2", name: "Half-moon edger", kits: [2] },
      { id: "t3", name: "Rakes", kits: [2] },
      { id: "t4", name: "Loppers", kits: [3] },
      { id: "t5", name: "Mattock", kits: [3] },
    ],
    [
      { name: "Blue crate", kits: [2], code: "4412" },
      { name: "Tool bag", kits: [3], code: "7719" },
    ],
    []
  );
}

export function sampleShopDay(): ShopDay {
  return {
    id: "sample",
    day: new Date().toISOString().slice(0, 10),
    stage: "loadout",
    pageIndex: 0,
    shownJobIds: [],
    leadProfileId: ME,
    leadName: "Jordan",
    clockedInAt: new Date().toISOString(),
    checks: [],
    checkedBy: {},
  };
}

/**
 * The area board at a stage of the day. Every area is prepped first:
 * nothing started, prepping the first area, its prep photo due, on to the
 * next, every area prepped, doing the work, and the after photo due.
 */
export type BoardStage = "open" | "prepping" | "prep_photo" | "next" | "all_prepped" | "working" | "after_photo";

export function sampleBoard(stage: BoardStage): AreaBoardData {
  const zones = sampleZones();
  const steps: AreaBoardData["steps"] = {};
  const tips: AreaBoardData["tips"] = {};
  const workStage = stage === "all_prepped" || stage === "working" || stage === "after_photo";
  const mineIndex = stage === "prepping" || stage === "prep_photo" || stage === "working" || stage === "after_photo" ? 0 : null;

  const states: AreaState[] = zones.map((zone, i) => {
    const source = PRACTICE_ZONES.find((z) => z.id === zone.id)!;
    const all = stepsFor(source.typeId, source.values);
    const prep = all.filter((s) => s.phase === "prep").length;
    const work = all.filter((s) => s.phase === "work").length;
    // How many steps are ticked, and whether its photos are in.
    let ticks = 0;
    let hasDuring = false;
    if (workStage || (stage === "next" && i === 0)) {
      ticks = prep;
      hasDuring = true;
    }
    if (i === 0 && stage === "prepping") ticks = 2;
    if (i === 0 && stage === "prep_photo") ticks = prep;
    if (i === 0 && stage === "working") ticks = prep + Math.max(1, work - 1);
    if (i === 0 && stage === "after_photo") ticks = all.length;
    steps[zone.id] = all.map((step, n) => ({ step, doneBy: n < ticks ? "Jordan" : null }));
    tips[zone.id] = tipsFor(source.typeId);
    const mine = i === mineIndex;
    const prepDone = ticks >= prep;
    const phase = ticks < prep ? "prep" : ticks < prep + work ? "work" : ticks < all.length ? "cleanup" : "done";
    return {
      zoneId: zone.id,
      status: mine ? "working" : "open",
      people: mine ? [{ profileId: ME, name: "Jordan" }] : [],
      kits: mine ? [2] : [],
      phase,
      stepsDone: ticks,
      stepsTotal: all.length,
      hasDuring,
      hasAfter: false,
      prepped: prepDone && hasDuring,
      photoDue: prepDone && !hasDuring ? "during" : ticks === all.length ? "after" : null,
      waitingReason: null,
      wouldTake: i === 2 ? [3] : [2],
    };
  });
  return {
    meId: ME,
    myZoneId: mineIndex != null ? zones[mineIndex].id : null,
    states,
    allPrepped: states.every((s) => s.prepped),
    steps,
    tips,
    tools: {},
  };
}

export function sampleWalkthrough(status: "requested" | "approved" | "rejected", bySub = false): JobWalkthrough {
  const now = new Date().toISOString();
  return {
    id: "walk",
    job_id: SAMPLE_JOB_ID,
    organization_id: "",
    requested_by: bySub ? null : ME,
    requested_at: now,
    requested_note: bySub ? "Green Edge Crew says they're finished." : "All three areas done.",
    status,
    reviewed_by: status === "requested" ? null : "am",
    reviewed_at: status === "requested" ? null : now,
    review_notes: status === "rejected" ? "Edging is loose by the front steps. Blow the mulch off the walk by the gate." : null,
    created_at: now,
    updated_at: now,
  };
}

/** Something the crew had to buy on the sample job. */
export const SAMPLE_RECEIPTS: JobReceipt[] = [
  { id: "r1", what: "2 bags of black mulch, the front ran short", amountCents: 1398, url: null, byName: "Jordan", at: new Date(2026, 8, 27).toISOString() },
];

/** The sample job's site map, numbered like its areas. */
export function sampleMap(): SiteMapData {
  return { kind: "sample", zones: PRACTICE_ZONES.map((z) => ({ name: z.name, color: z.color, points: z.points })) };
}

/** A subcontractor's crew sheet for the sample job. */
export function sampleSubSheet(usesOurTools: boolean, walkthrough: SubCrewSheet["walkthrough"] = null): SubCrewSheet {
  const zones = sampleZones();
  return {
    token: "sample",
    jobId: SAMPLE_JOB_ID,
    sessionId: "visit",
    businessName: "JS Landscaping",
    subcontractorName: "Green Edge Crew",
    usesOurTools,
    startsOn: new Date().toISOString().slice(0, 10),
    endsOn: new Date().toISOString().slice(0, 10),
    purpose: null,
    address: PRACTICE_ADDRESS,
    lat: null,
    lng: null,
    clientFirstName: "Sarah",
    accountManager: { name: "Jace", phone: "4105550100" },
    progress: { usesOurTools, pickedUpAt: null, onWayAt: null, arrivedAt: null, finishedAt: null },
    shop: usesOurTools ? { address: "The shop", arriveBy: SAMPLE_SHOP.arriveBy, accessCodes: SAMPLE_SHOP.accessCodes } : null,
    kits: usesOurTools
      ? [
          { number: 2, container: "Blue crate", code: "4412" },
          { number: 3, container: "Tool bag", code: "7719" },
        ]
      : [],
    zones,
    siteMap: sampleMap(),
    areaStates: Object.fromEntries(zones.map((z) => [z.id, "todo" as SubAreaState])),
    walkthrough,
  };
}

/** Each area's state for the subcontractor's pages: not finished, or every after photo in. */
export function sampleSubAreas(stage: "todo" | "all_done"): Record<string, SubAreaState> {
  return Object.fromEntries(sampleZones().map((z) => [z.id, stage === "all_done" ? "done" : "todo"]));
}

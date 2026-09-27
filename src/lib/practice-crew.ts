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
import { PRACTICE_ADDRESS, practiceWorkOrder } from "@/lib/practice-sample";

export const SAMPLE_JOB_ID = "sample";
const ME = "me";

/** Which rate-card service each sample area is. */
const TYPE_OF: Record<string, string> = { "Landscape Bed": "landscape-bed", "Plant / Bush Removal": "plant-bush-removal" };

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

/** The area board at a stage: nothing started, one area prepped, one cleaned up, or all done. */
export function sampleBoard(stage: "open" | "prep_done" | "cleanup_done" | "all_done"): AreaBoardData {
  const zones = sampleZones();
  const steps: AreaBoardData["steps"] = {};
  const tips: AreaBoardData["tips"] = {};
  const states: AreaState[] = zones.map((zone, i) => {
    const typeId = TYPE_OF[zone.service] ?? "landscape-bed";
    const all = stepsFor(typeId);
    const mine = i === 0 && (stage === "prep_done" || stage === "cleanup_done");
    const done = stage === "all_done";
    const tickedCount = mine ? (stage === "prep_done" ? all.filter((s) => s.phase === "prep").length : all.length) : done ? all.length : 0;
    steps[zone.id] = all.map((step, n) => ({ step, doneBy: n < tickedCount ? "Jordan" : null }));
    tips[zone.id] = tipsFor(typeId);
    return {
      zoneId: zone.id,
      status: done ? "done" : mine ? "working" : "open",
      people: mine ? [{ profileId: ME, name: "Jordan" }] : [],
      kits: mine ? [2] : [],
      phase: done ? "done" : mine ? (stage === "prep_done" ? "prep" : "cleanup") : "prep",
      stepsDone: tickedCount,
      stepsTotal: all.length,
      hasDuring: done || (mine && stage === "cleanup_done"),
      hasAfter: done,
      photoDue: mine ? (stage === "prep_done" ? "during" : "after") : null,
      waitingReason: null,
      wouldTake: i === 2 ? [3] : [2],
    };
  });
  return { meId: ME, myZoneId: stage === "prep_done" || stage === "cleanup_done" ? zones[0].id : null, states, steps, tips, tools: {} };
}

/** The walkthrough; `bySub` is a subcontractor's We're finished, which has no one on our team behind it. */
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
    areaStates: Object.fromEntries(zones.map((z) => [z.id, "todo" as SubAreaState])),
    walkthrough,
  };
}

/** Each area's state for the subcontractor's pages. */
export function sampleSubAreas(stage: "todo" | "first_prepped" | "all_done"): Record<string, SubAreaState> {
  return Object.fromEntries(
    sampleZones().map((z, i) => [z.id, stage === "all_done" ? "done" : stage === "first_prepped" && i === 0 ? "prepped" : "todo"])
  );
}

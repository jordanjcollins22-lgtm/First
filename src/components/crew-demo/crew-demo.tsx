"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronLeft, ClipboardCheck, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ShopFlow, type ShopActions } from "@/components/crew/shop-flow";
import { TodayBoard } from "@/components/crew/today-board";
import { type AreaActions } from "@/components/job/area-board";
import { WorkOrderView } from "@/components/job/work-order-view";
import type { WorkOrderPageData } from "@/lib/data/work-order";
import { allPrepped, boardState, canTick, stepsFor, type AreaNeeds, type BoardZone, type Tip, type WorkRow } from "@/lib/area-work";
import { buildLoadout, type LoadoutCheck, type LoadoutContainer, type LoadoutTool } from "@/lib/loadout";
import type { WorkOrderZone } from "@/lib/work-order";
import type { CrewEvent, CrewEventKind, Stop } from "@/lib/crew-day";
import type { AreaBoardData } from "@/lib/data/area-board";
import type { ShopDay } from "@/lib/data/shop-flow";
import type { JobReceipt } from "@/lib/data/job-receipts";
import type { ProposalSiteImageTransform } from "@/types/domain";

const ME = "demo-me";
const OK = { ok: true as const };
type Screen = "shop" | "road" | "site";

/**
 * A real job's crew day, to click through: the same screens the crew use,
 * each button run here instead of on the server. The shop and the load-out,
 * On my way, I've arrived, every area prepped and photographed, then the
 * install, the after photos, a receipt, and asking for the walkthrough.
 * Nothing is saved, uploaded or sent; Start over puts it back.
 */
export function CrewDemo({
  jobId,
  personName,
  viewingAs = null,
  sheet,
  stop,
  zones,
  boardZones,
  needs,
  tips,
  loadout: loadoutInput,
  shop,
  siteImagePath,
  imageTransform,
  accountManager,
}: {
  jobId: string;
  personName: string;
  /** The crew member whose phone this is, when it's somebody's in particular. */
  viewingAs?: string | null;
  /** The job's crew sheet, exactly as the crew's phone loads it. */
  sheet: WorkOrderPageData;
  stop: Stop;
  zones: WorkOrderZone[];
  boardZones: BoardZone[];
  needs: Record<string, AreaNeeds>;
  tips: Record<string, Tip[]>;
  loadout: { kits: number[]; toolIds: string[]; tools: LoadoutTool[]; containers: LoadoutContainer[]; kitPhotos?: Record<number, string> };
  shop: { arriveBy: string | null; accessCodes: string | null; address: string | null } | null;
  siteImagePath: string | null;
  imageTransform: ProposalSiteImageTransform | null;
  accountManager: { name: string; phone: string | null } | null;
}) {
  const first = personName.split(/\s+/)[0];
  const [screen, setScreen] = useState<Screen>("shop");
  const [shopDay, setShopDay] = useState<ShopDay | null>(null);
  const [events, setEvents] = useState<CrewEvent[]>([]);
  const [working, setWorking] = useState<WorkRow[]>([]);
  const [ticked, setTicked] = useState<Record<string, string[]>>({});
  const [photos, setPhotos] = useState<{ zoneId: string; kind: string }[]>([]);
  const [receipts, setReceipts] = useState<JobReceipt[]>([]);
  const [asked, setAsked] = useState(false);

  function startOver() {
    setScreen("shop");
    setShopDay(null);
    setEvents([]);
    setWorking([]);
    setTicked({});
    setPhotos([]);
    setReceipts([]);
    setAsked(false);
    window.scrollTo({ top: 0 });
  }

  const at = () => new Date().toISOString();
  const record = (kind: CrewEventKind, eventJobId: string | null) => setEvents((prev) => [...prev, { kind, jobId: eventJobId, at: at() }]);

  // ------------------------------------------------------------ the shop
  const checks: LoadoutCheck[] | undefined = shopDay?.checks;
  const loadout = useMemo(
    () =>
      buildLoadout(
        [{ sessionId: "demo", jobId, customerName: stop.customerName, address: stop.address, kits: loadoutInput.kits, toolIds: loadoutInput.toolIds, materials: [] }],
        loadoutInput.tools,
        loadoutInput.containers,
        checks ?? [],
        loadoutInput.kitPhotos ?? {}
      ),
    [checks, jobId, loadoutInput, stop.address, stop.customerName]
  );
  const shopActions: ShopActions = {
    arriveAtShop: async () => {
      record("arrived_shop", null);
      setShopDay({ id: "demo", day: at().slice(0, 10), stage: "loadout", pageIndex: 0, shownJobIds: [], leadProfileId: ME, leadName: first, clockedInAt: at(), checks: [], checkedBy: {} });
      return OK;
    },
    tickShopItem: async ({ kind, key, checked }) => {
      setShopDay((day) =>
        day
          ? {
              ...day,
              checks: checked ? [...day.checks, { kind, key }] : day.checks.filter((c) => !(c.kind === kind && c.key === key)),
              checkedBy: { ...day.checkedBy, [`${kind}:${key}`]: first },
            }
          : day
      );
      return OK;
    },
    setShopPage: async ({ pageIndex }) => {
      setShopDay((day) => (day ? { ...day, pageIndex } : day));
      return OK;
    },
    setShopStage: async ({ stage }) => {
      setShopDay((day) => (day ? { ...day, stage } : day));
      return OK;
    },
    setShownJobs: async ({ jobIds }) => {
      setShopDay((day) => (day ? { ...day, shownJobIds: jobIds } : day));
      return OK;
    },
    headOut: async () => {
      record("left_shop", null);
      setScreen("road");
      window.scrollTo({ top: 0 });
      return OK;
    },
  };

  // ------------------------------------------------------------ the road
  const roadActions = {
    record: async (kind: CrewEventKind, eventJobId: string | null) => {
      record(kind, eventJobId);
      if (kind === "arrived_job") {
        setScreen("site");
        window.scrollTo({ top: 0 });
      }
      return OK;
    },
    undo: async () => {
      setEvents((prev) => prev.slice(0, -1));
      return OK;
    },
  };

  // ------------------------------------------------------------ on site
  const needsMap = useMemo(() => new Map(Object.entries(needs)), [needs]);
  const states = boardState({
    zones: boardZones,
    needs: needsMap,
    working,
    ticked: new Map(Object.entries(ticked).map(([zoneId, keys]) => [zoneId, new Set(keys)])),
    photos,
  });
  const everyAreaPrepped = allPrepped(states);
  const board: AreaBoardData = {
    meId: ME,
    myZoneId: working.find((w) => w.profileId === ME)?.zoneId ?? null,
    states,
    allPrepped: everyAreaPrepped,
    previousLayout: false,
    steps: Object.fromEntries(
      boardZones.map((z) => [z.id, stepsFor(z.serviceTypeId, z.values).map((step) => ({ step, doneBy: ticked[z.id]?.includes(step.key) ? first : null }))])
    ),
    tips,
    tools: Object.fromEntries(boardZones.map((z) => [z.id, needs[z.id]?.tools ?? []])),
  };
  const areaActions: AreaActions = {
    start: async (zoneId) => {
      const state = states.find((s) => s.zoneId === zoneId);
      if (!state) return { ok: false, message: "That area isn't on the site map." };
      if (state.status === "done") return { ok: false, message: "That area is finished." };
      if (state.prepped && !everyAreaPrepped) return { ok: false, message: "This area is prepped. Prep the next one: the install starts once every area is prepped." };
      setWorking([{ zoneId, profileId: ME, name: first, kits: state.status === "working" ? state.kits : state.wouldTake }]);
      return OK;
    },
    leave: async () => {
      setWorking([]);
      return OK;
    },
    tick: async (zoneId, key, done) => {
      const zone = boardZones.find((z) => z.id === zoneId);
      if (!zone) return { ok: false, message: "That area isn't on the site map." };
      const list = stepsFor(zone.serviceTypeId, zone.values);
      const step = list.find((s) => s.key === key);
      if (!step) return { ok: false, message: "That step isn't on this area." };
      if (done) {
        const verdict = canTick(step, list, new Set(ticked[zoneId] ?? []), photos.some((p) => p.zoneId === zoneId && p.kind === "during"), everyAreaPrepped);
        if (!verdict.ok) return verdict;
      }
      setTicked((prev) => ({ ...prev, [zoneId]: done ? [...(prev[zoneId] ?? []), key] : (prev[zoneId] ?? []).filter((k) => k !== key) }));
      return OK;
    },
    photo: async (zoneId, kind) => {
      setPhotos((prev) => [...prev, { zoneId, kind }]);
      // The photo frees the area, the same as on the real sheet.
      setWorking([]);
      return OK;
    },
  };
  const allDone = states.length > 0 && states.every((s) => s.status === "done");


  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        {/* On site the crew sheet has its own way back. */}
        {screen === "site" ? (
          <span />
        ) : (
          <Link href={`/jobs/${jobId}`} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
            <ChevronLeft className="h-4 w-4" /> The job
          </Link>
        )}
        <button type="button" onClick={startOver} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
          <RotateCcw className="h-3.5 w-3.5" /> Start over
        </button>
      </div>
      <p className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-950 dark:bg-sky-950/30 dark:text-sky-100">
        <span className="font-semibold">Demo{viewingAs ? ` as ${viewingAs}` : ""}.</span>{" "}
        {viewingAs ? `What ${first} sees` : "The crew's screens"} for {stop.customerName}&apos;s job. Tap through it like the crew would. Nothing is saved,
        uploaded or sent.
      </p>

      {screen === "shop" && (
        <ShopFlow
          me={{ profileId: ME, name: first, canLead: true, arrived: Boolean(shopDay) }}
          shopDay={shopDay}
          loadout={loadout}
          stops={[stop]}
          siteMaps={
            shopDay?.shownJobIds.includes(jobId)
              ? [{ jobId, customerName: stop.customerName, address: stop.address, siteImagePath, imageTransform, zones }]
              : []
          }
          present={shopDay ? [{ profileId: ME, name: first }] : []}
          shop={shop}
          actions={shopActions}
        />
      )}

      {screen === "road" && <TodayBoard stops={[stop]} events={events} personName={personName} actions={roadActions} />}

      {screen === "site" && (
        // The crew sheet itself, the screen the crew's phone opens on site:
        // the checklist to load, the map, the areas, receipts, photos. The
        // areas and receipts run on this screen only.
        <div className="-mx-4">
          <WorkOrderView
            jobId={jobId}
            {...sheet}
            crew
            back={{ href: `/jobs/${jobId}`, label: "Back to the job" }}
            demo={{
              board,
              areaActions,
              receipts,
              onReceipt: (r) => setReceipts((prev) => [r, ...prev]),
              after: allDone ? (
                <section className="flex flex-col gap-3 rounded-2xl border-2 border-primary/40 bg-primary/5 p-4">
                  <p className="flex items-center gap-1.5 text-lg font-bold">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Every area is done
                  </p>
                  {asked ? (
                    <>
                      <p className="text-sm">
                        Asked. {accountManager?.name.split(/\s+/)[0] ?? "The account manager"} is coming to walk it. Keep the tools out until it&apos;s walked.
                      </p>
                      <p className="text-sm text-muted-foreground">That&apos;s the end of the crew&apos;s day on this job. The walkthrough is the account manager&apos;s.</p>
                      <Button type="button" variant="outline" className="h-11 w-full" onClick={startOver}>
                        <RotateCcw className="mr-1.5 h-4 w-4" /> Start the demo over
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">Keep the tools out. The account manager walks the job before anyone leaves.</p>
                      <Button type="button" className="h-14 text-base font-semibold" onClick={() => setAsked(true)}>
                        <ClipboardCheck className="mr-2 h-5 w-5" /> Ask {accountManager?.name.split(/\s+/)[0] ?? "the manager"} to walk it
                      </Button>
                    </>
                  )}
                </section>
              ) : null,
            }}
          />
        </div>
      )}
    </div>
  );
}

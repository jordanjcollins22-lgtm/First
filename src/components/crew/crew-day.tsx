import { Suspense, type ReactNode } from "react";

import { createClient } from "@/lib/supabase/server";
import { getCrewDay, type CrewDayData } from "@/lib/data/crew-day";
import { getLoadout } from "@/lib/data/loadout";
import { leaveBlockedBy, type Loadout } from "@/lib/loadout";
import { readDay, type DayPhase } from "@/lib/crew-day";
import { getDayLoadout, getShopDay, getShopInfo, getSiteMaps, whoIsAtTheShop } from "@/lib/data/shop-flow";
import { canLead } from "@/lib/shop-flow";
import { myOpenEntry } from "@/lib/data/time-clock";
import { LoadoutPanel } from "@/components/crew/loadout-panel";
import { LocationBeacon } from "@/components/crew/location-beacon";
import { NextUpCard } from "@/components/crew/next-up-card";
import { TodayBoard } from "@/components/crew/today-board";
import { CrewBudgetRemaining } from "@/components/crew/crew-budget-remaining";
import { CrewEquipmentLog } from "@/components/equipment/crew-equipment-log";
import { ShopFlow } from "@/components/crew/shop-flow";
import { ShopFlowLive } from "@/components/crew/shop-flow-live";
import { ClockControl } from "@/components/crew/clock-control";
import type { Profile } from "@/types/domain";

/** What the slots below the day are handed, so they never load the day twice. */
export interface CrewDayContext {
  day: CrewDayData;
  /** This person's own load-out for today. */
  loadout: Loadout | null;
  phase: DayPhase;
}

/** Whether this person is marked lead on any of today's jobs. */
async function leadsAnyStopToday(profileId: string, jobIds: string[]): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("job_crew").select("job_id").eq("profile_id", profileId).eq("is_lead", true).in("job_id", jobIds).limit(1);
  return (data ?? []).length > 0;
}

/**
 * The crew's own day: clock, the shop's load-out, the one button for the
 * next step, the hours left, the machines' hours, and what is next.
 *
 * Two homes draw it. My Day draws it as it always has, with its pages for
 * directions and the crew sheet. The new layout draws it `inline`: the sheet
 * is on the same screen, directions open the phone's maps, a day with
 * nothing on it says so plainly, and the lead's crew sits under their own
 * day. The slots are render functions so both get the day already loaded.
 */
export async function CrewDay({
  profile,
  inline = false,
  nothingToday,
  lead,
  sheets,
  after,
}: {
  profile: Profile;
  inline?: boolean;
  /** Drawn instead of the day board when nothing is booked today. Inline only. */
  nothingToday?: (ctx: CrewDayContext) => ReactNode;
  /** The lead's crew, straight under their own day. Replaces the lead's budget line. */
  lead?: (ctx: CrewDayContext) => ReactNode;
  /** Today's job sheets, under the day board, once the truck has left. */
  sheets?: (ctx: CrewDayContext) => ReactNode;
  /** Anything else, at the bottom. */
  after?: (ctx: CrewDayContext) => ReactNode;
}) {
  const day = await getCrewDay().catch(() => null);

  if (!day) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <h1 className="mb-1 text-2xl font-bold">Today</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          {inline ? (
            "Couldn't load your day. Check your signal and pull down to reload."
          ) : (
            <>
              Couldn&apos;t load your day. If this is a fresh setup, run <code>supabase/migrations/0082_crew_day.sql</code> and reload.
            </>
          )}
        </p>
      </div>
    );
  }

  // Without somewhere to press start, every hours figure in the business is
  // somebody's recollection.
  const open = await myOpenEntry(profile.id).catch(() => null);

  // The shop list: everything every stop needs, added up, ticked before the
  // truck leaves. It sits above the board until they have left the shop and
  // folds up after, because by then it is either on the truck or it is not.
  const loadout = await getLoadout(profile.id, day.day).catch(() => null);
  const phase = readDay(day.events, day.stops).phase;
  const loading = phase === "before_shop" || phase === "at_shop";
  const ctx: CrewDayContext = { day, loadout, phase };

  // Nothing booked: on the new layout, a plain "nothing today, here's your
  // next day" instead of a board telling them to go to the shop.
  const empty = inline && day.stops.length === 0 && Boolean(nothingToday);

  // The morning at the shop, run from the tablet and followed on every
  // phone: clock in, one kit at a time, the maps, out the door. Shown until
  // this person has left the shop; after that the day board takes over.
  const shopDay = loading && !empty ? await getShopDay(day.day).catch(() => null) : null;
  const [dayLoadout, siteMaps, present, shopInfo] =
    loading && !empty
      ? await Promise.all([
          getDayLoadout(day.day, shopDay?.checks ?? []).catch(() => null),
          shopDay && shopDay.stage !== "loadout" ? getSiteMaps(shopDay.shownJobIds).catch(() => []) : Promise.resolve([]),
          whoIsAtTheShop(day.day).catch(() => []),
          getShopInfo().catch(() => null),
        ])
      : [null, [], [], null];
  const leadsAStop = day.stops.length > 0 && (await leadsAnyStopToday(profile.id, day.stops.map((s) => s.jobId)));
  const blockedBy = loading && dayLoadout ? leaveBlockedBy(dayLoadout) : loadout ? leaveBlockedBy(loadout) : null;
  // The sheets show once the address does: not while the truck is half loaded.
  const showSheets = Boolean(sheets) && day.stops.length > 0 && phase !== "day_over" && !(loading && (dayLoadout || blockedBy));

  return (
    <div className="mx-auto max-w-md px-4 py-4 sm:py-6">
      {/* Tells the office where this phone is from the shop until the day
          is over, while the app is open. */}
      <LocationBeacon active={phase !== "before_shop" && phase !== "day_over"} />
      {loading && dayLoadout && (
        <div className="mb-4" data-tour="crew-today">
          <ShopFlowLive shopDayId={shopDay?.id ?? null} />
          <ShopFlow
            me={{ profileId: profile.id, name: profile.full_name || profile.email, canLead: canLead({ roles: profile.roles, leadsAStop }), arrived: phase !== "before_shop" }}
            shopDay={shopDay}
            loadout={dayLoadout}
            stops={day.stops}
            siteMaps={siteMaps}
            present={present}
            shop={shopInfo}
            inline={inline}
          />
        </div>
      )}
      {loadout && loading && !dayLoadout && !empty && (
        <div className="mb-4">
          <LoadoutPanel day={day.day} loadout={loadout} />
        </div>
      )}
      <div data-tour="crew-clock">
        <ClockControl
          open={open}
          stops={day.stops.map((stop) => ({
            jobId: stop.jobId,
            sessionId: stop.sessionId,
            name: stop.customerName,
          }))}
        />
      </div>
      {empty && nothingToday ? (
        <div data-tour="crew-today">{nothingToday(ctx)}</div>
      ) : (
        /* One thing at a time: while the shop's load-out is up, it is the
           only box. Its last step heads out, for everybody at the shop, and
           then the day board takes over with I've arrived. */
        (!loading || (phase === "at_shop" && !dayLoadout)) && (
          <div data-tour="crew-today">
            <TodayBoard
              stops={day.stops}
              events={day.events}
              personName={profile.full_name || profile.email}
              leaveBlockedBy={blockedBy}
              inline={inline}
              sheets={showSheets}
            />
          </div>
        )
      )}
      {loadout && !loading && phase !== "day_over" && !empty && (
        <div className="mt-4">
          <LoadoutPanel day={day.day} loadout={loadout} compact />
        </div>
      )}
      {lead ? (
        <div className="mt-4">{lead(ctx)}</div>
      ) : (
        /* The lead's hours left against the job's budget, once they're out. */
        !loading &&
        phase !== "day_over" &&
        leadsAStop && (
          <div className="mt-4">
            <Suspense fallback={null}>
              <CrewBudgetRemaining profileId={profile.id} organizationId={profile.organization_id} />
            </Suspense>
          </div>
        )
      )}
      {showSheets && sheets && (
        <div className="mt-4" data-tour="crew-sheet">
          {sheets(ctx)}
        </div>
      )}
      {/* End of the day: hours and miles on the machines, for their upkeep. */}
      {(phase === "stops_done" || phase === "day_over") && (
        <div className="mt-4" data-tour="crew-equipment">
          <Suspense fallback={null}>
            <CrewEquipmentLog />
          </Suspense>
        </div>
      )}
      {/* Below the board, not above it: this is what to do with the hours
          left over once the board says the day is done. On an empty day the
          "nothing today" card already carries it. */}
      {!empty && (
        <div className="mt-4">
          <NextUpCard today={day.day} visit={day.nextProject} existing={day.earlyStart} stops={day.stops} events={day.events} />
        </div>
      )}
      {after?.(ctx)}
    </div>
  );
}

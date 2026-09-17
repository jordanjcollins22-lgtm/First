import Link from "next/link";
import { ChevronRight, MessageSquarePlus } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { isFieldOnly } from "@/lib/affiliate-roles";
import { getCrewDay } from "@/lib/data/crew-day";
import { getLoadout } from "@/lib/data/loadout";
import { leaveBlockedBy } from "@/lib/loadout";
import { readDay } from "@/lib/crew-day";
import { LoadoutPanel } from "@/components/crew/loadout-panel";
import { LocationBeacon } from "@/components/crew/location-beacon";
import { AutoRefresh } from "@/components/crew/auto-refresh";
import { CrewsTodayPanel } from "@/components/crew/crews-today-panel";
import { CrewLeaderboard } from "@/components/crew/crew-leaderboard";
import { getCrewBoards } from "@/lib/data/crew-leaderboard";
import { LeaderboardsView } from "@/components/leaderboards/leaderboards-view";
import { getEvaluationBoards } from "@/lib/data/evaluation-leaderboard";
import { canSeeCompanyMoney } from "@/lib/roles";
import { getCrewsToday } from "@/lib/data/crews-today";
import { pullGhlCalendarIfStale } from "@/lib/ghl/inbound";
import { personOpenTime, sellingTeam, type PersonOpenTime } from "@/lib/data/open-time";
import { OpenTimePanel, TeamOpenTimePanel } from "@/components/team/open-time-panel";
import { createClient } from "@/lib/supabase/server";
import { dateKeyIn } from "@/lib/time-zone";
import { NextUpCard } from "@/components/crew/next-up-card";
import { EarlyStartQueue } from "@/components/crew/early-start-queue";
import { pendingEarlyStarts } from "@/lib/data/early-start";
import { TodayBoard } from "@/components/crew/today-board";
import { ShopFlow } from "@/components/crew/shop-flow";
import { ShopFlowLive } from "@/components/crew/shop-flow-live";
import { getDayLoadout, getShopDay, getSiteMaps, whoIsAtTheShop } from "@/lib/data/shop-flow";
import { canLead } from "@/lib/shop-flow";
import { ClockControl } from "@/components/crew/clock-control";
import { myOpenEntry } from "@/lib/data/time-clock";
import type { Profile } from "@/types/domain";
import { getDashboard, loadJobInputs } from "@/lib/data/dashboard";
import { getCommissionFor } from "@/lib/data/commission";
import { buildMyWork, type MyWork } from "@/lib/my-work";
import { getToday } from "@/lib/data/today";
import { getCallList } from "@/lib/data/call-list";
import { CallListPanel } from "@/components/sales/call-list";
import { CollectPanel } from "@/components/sales/collect-panel";
import { OutreachForm } from "@/components/marketing/outreach-form";
import { OutreachBoardView } from "@/components/marketing/outreach-board";
import { getOutreachBoard } from "@/lib/data/outreach-links";
import { listPaymentsToCollect, type PaymentToCollect } from "@/lib/data/collections";
import type { CallList } from "@/lib/call-list";
import { isAccountManager } from "@/lib/affiliate-roles";
import { TodayPanel } from "@/components/dashboard/today-panel";
import { withOwed, type TodayView } from "@/lib/today";
import type { DashboardData } from "@/lib/dashboard";
import type { CommissionSummary } from "@/lib/commission";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { DashboardSections } from "@/components/dashboard/dashboard-sections";
import { ManagedJobs, NeedsSubmitting, UpcomingEvaluations } from "@/components/dashboard/my-work-panels";
import { CommissionPanel } from "@/components/payments/commission-panel";
import { Suspense } from "react";

import { PageTabs } from "@/components/ui/page-tabs";
import { GrowthView } from "@/components/growth/growth-view";
import { growthView } from "@/lib/data/growth";
import { isOwnerLevel } from "@/lib/roles";
import { isTwilioConfigured } from "@/lib/env";
import { getMyNotificationSettings } from "@/lib/data/notification-preferences";
import { NotificationSettings } from "@/components/notifications/notification-settings";
import { marketingState } from "@/lib/data/marketing";
import { MarketingTodo } from "@/components/marketing/marketing-todo";
import { MyRoutes } from "@/components/marketing/my-routes";
import { playsAssignedTo } from "@/lib/marketing-plays";
import { opsState, type OpsState } from "@/lib/data/ops";
import { OpsPanel } from "@/components/ops/ops-panel";

/**
 * One person's own work — whoever they are.
 *
 * The dashboard answers "what is the business doing". This answers "what is on
 * me", which is a different question with a different audience of one.
 *
 * It reads top to bottom in the order somebody actually needs it. Today first,
 * because that is what an account manager standing in a driveway at nine in
 * the morning is asking. Then what they owe somebody — the visits made but
 * never written up, which is the pile no other screen in the app shows,
 * because a job with an unsubmitted evaluation looks perfectly healthy from
 * every other angle. Then what is coming, then the live work they are
 * carrying, then what they have earned.
 *
 * One page rather than one per role: an admin and an account manager want the
 * same five answers about themselves, and a second copy of this screen would
 * be a second thing to keep in step.
 *
 * Not tab-gated: it shows the signed-in person their own work and nobody
 * else's, so there is nothing here to withhold, and putting it behind a tick
 * is how somebody ends up with no screen to open.
 *
 * A crew member asking "what is on me" is asking about stops, not managed
 * jobs and commission, so they get the crew's day here instead. Same
 * question, same address, different answer — rather than two entries in the
 * nav where only one of them was ever the right one for you.
 */
export default async function MyDayPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const viewer = await getCurrentProfile();
  const day =
    viewer && isFieldOnly(viewer.roles) ? (
      <CrewDay profile={viewer} />
    ) : viewer && isGrowthOnly(viewer.roles) ? (
      await GrowthDay(viewer)
    ) : (
      await OfficeDay()
    );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <PageTabs
        tabs={[
          { key: "day", label: "My Day", content: day },
          // Owner-level only, and not because the numbers are secret -- they
          // are on Business too. It is that the question this tab answers is
          // "is the business getting better and what is in my way", which is
          // nobody's question but the person answerable for it.
          // Streamed, not awaited. Both of these are secondary screens behind a
          // tab nobody has clicked yet, and awaiting them here meant the day --
          // the thing somebody actually opened the app for -- could not be
          // drawn until the pulse, the owner's hours and the alert settings had
          // all been read. They now arrive underneath it.
          {
            key: "growth",
            label: "Growth",
            visible: isOwnerLevel(viewer?.roles ?? []),
            blurb: "Five numbers, the one thing in the way, and one button.",
            content: isOwnerLevel(viewer?.roles ?? []) ? (
              <Suspense fallback={<TabLoading />}>
                <GrowthTab />
              </Suspense>
            ) : null,
          },
          // Everybody's standing, on everybody's screen: the person who
          // wants to know where they rank is the person on the board.
          {
            key: "leaderboards",
            label: "Leaderboards",
            content: (
              <Suspense fallback={<TabLoading />}>
                <LeaderboardsTab />
              </Suspense>
            ),
          },
          // Personal settings on the personal screen. They were a nav entry
          // of their own for something nobody opens twice a year.
          {
            key: "alerts",
            label: "Alerts",
            visible: !(viewer && isGrowthOnly(viewer.roles)),
            content: (
              <Suspense fallback={<TabLoading />}>
                <AlertsTab />
              </Suspense>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * Somebody whose whole job is answering neighbours: the office role and
 * nothing else. Their day is the comment responder, and only that. The
 * crews, the calls, the tiles and the money are somebody else's day.
 */
function isGrowthOnly(roles: string[]): boolean {
  const held = roles.map((r) => r.toLowerCase().trim());
  return held.includes("office") && held.every((r) => r === "office");
}

async function GrowthDay(profile: Profile) {
  const board = await getOutreachBoard({ onlyProfileId: profile.id }).catch((err) => {
    console.error("Outreach board failed to load:", err);
    return null;
  });
  const first = (profile.first_name || profile.full_name || "").split(" ")[0];
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold">My Day</h1>
      <p className="mb-4 text-muted-foreground">
        {first ? `${first}, ` : ""}someone asked for a landscaper? Screenshot it, get the reply, paste it with your link.
      </p>

      <section className="mb-5 rounded-xl border border-primary/40 bg-primary/5 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <MessageSquarePlus className="h-4 w-4 text-primary" />
          Answer a comment or message
        </h2>
        <OutreachForm />
      </section>

      {board && board.total.posts > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Your links, and what came of them</h2>
          <OutreachBoardView board={board} scope="mine" />
        </section>
      ) : (
        <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
          Nothing answered yet. The first screenshot you upload starts your list.
        </p>
      )}
    </div>
  );
}

async function OfficeDay() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <h1 className="mb-1 text-2xl font-bold">My Day</h1>
        <p className="text-sm text-muted-foreground">Sign in to see your day.</p>
      </div>
    );
  }

  // Bookings made in GoHighLevel, brought in first so today's list is
  // today's list. Throttled inside; most opens cost nothing.
  await pullGhlCalendarIfStale(profile.organization_id).catch(() => null);

  // Six reads, together rather than one after another.
  //
  // They do not depend on each other -- the board, the forward work, the
  // book, the early starts, the marketing and the pulse are six separate
  // questions about the same person -- and asked in series they were six
  // round trips the page sat through end to end. Each still fails on its own:
  // a money table that is not set up costs the commission panel and nothing
  // else, which is why every one of them carries its own catch.
  const [data, work, today, commission, earlyStarts, marketing, ops, calls, toCollect, crewsToday, openTime] = await Promise.all([
    getDashboard("today", new Date(), { forProfileId: profile.id }).catch((err) => {
      console.error("My Day failed to load:", err);
      return null as DashboardData | null;
    }),
    loadJobInputs({ forProfileId: profile.id })
      .then((inputs) => buildMyWork(inputs))
      .catch((err) => {
        console.error("My work failed to load:", err);
        return null as MyWork | null;
      }),
    // The narrow question the week-shaped piles below never answered: did we
    // sell anything today, and did any money turn up.
    getToday({ mine: profile.id }).catch((err) => {
      console.error("Today failed to load:", err);
      return null as TodayView | null;
    }),
    getCommissionFor(profile).catch((err) => {
      console.error("Commission failed to load:", err);
      return null as CommissionSummary | null;
    }),
    pendingEarlyStarts().catch((err) => {
      console.error("Early start requests failed to load:", err);
      return [];
    }),
    // Read, not synced. The sync used to run here on every load and was
    // timing out against the API's statement limit -- so opening the app
    // meant waiting out the timeout before the page would draw, which is
    // what "it will not open" looks like from the outside. The
    // marketing-sync cron does the same work every five minutes and
    // finishes in hundredths of a second.
    marketingState({ sync: false }).catch((err) => {
      console.error("Marketing plays failed to load:", err);
      return { plays: [], reviews: [], defaults: [], autoApproved: 0 };
    }),
    opsState().catch((err) => {
      console.error("The pulse failed to load:", err);
      return null as OpsState | null;
    }),
    // The most valuable list in the business: proposals sent and not
    // answered, and proposals answered no. Only for the people who ring them.
    isAccountManager(profile.roles) || isOwnerLevel(profile.roles) || profile.roles.includes("admin")
      ? getCallList(profile).catch((err) => {
          console.error("Call list failed to load:", err);
          return null as CallList | null;
        })
      : Promise.resolve(null as CallList | null),
    // Cash and checks clients have asked us to come and collect.
    isAccountManager(profile.roles) || isOwnerLevel(profile.roles) || profile.roles.includes("admin")
      ? listPaymentsToCollect(profile).catch((err) => {
          console.error("Payments to collect failed to load:", err);
          return [] as PaymentToCollect[];
        })
      : Promise.resolve([] as PaymentToCollect[]),
    // Today's jobs, crews and load-outs, on the business clock.
    getCrewsToday(dateKeyIn(new Date())).catch((err) => {
      console.error("Crews today failed to load:", err);
      return null;
    }),
    // The hours between evaluations, and what is being done with them.
    loadOpenTime(profile).catch((err) => {
      console.error("Open time failed to load:", err);
      return { mine: null as PersonOpenTime | null, team: [] as PersonOpenTime[] };
    }),
  ]);

  if (!data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <h1 className="mb-1 text-2xl font-bold">My Day</h1>
        <p className="rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t load your day right now. Reload the page and try again.
        </p>
      </div>
    );
  }

  const { summary } = data;
  const nothing =
    data.evaluations.every((s) => s.rows.length === 0) && data.jobs.every((s) => s.rows.length === 0);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
      <h1 className="text-2xl font-bold">My Day</h1>
      <p className="mb-4 text-muted-foreground">
        {profile.full_name || profile.email} — your clients and your jobs.
      </p>

      {/* Above the tiles: the only thing on this page with a half-life. The
          crew are standing in a finished garden waiting for an answer. */}
      <EarlyStartQueue requests={earlyStarts} />

      {/* The hours between evaluations are where the next jobs come from.
          Each seller sees their own; the office sees everyone's. */}
      {openTime.mine && <OpenTimePanel me={openTime.mine} />}
      {openTime.team.length > 0 && <TeamOpenTimePanel team={openTime.team} />}

      {/* What is being done today, by whom, with what on the truck. The
          same load-out the crew tick on their phones, so a wrong list is
          caught here before it is discovered at the first stop. */}
      {crewsToday && crewsToday.stops.length > 0 && <AutoRefresh seconds={60} />}
      {crewsToday && (
        <CrewsTodayPanel
          today={crewsToday}
          showTicks={isOwnerLevel(profile.roles) || profile.roles.includes("admin") || profile.roles.includes("overhead") || profile.roles.includes("office")}
        />
      )}

      {/* Above everything else for an account manager: the money on the
          table, and who to ring about it. */}
      {toCollect.length > 0 && <CollectPanel lines={toCollect} />}

      {calls && (calls.now.length > 0 || calls.later.length > 0) && (
        <CallListPanel list={calls} callerFirstName={(profile.first_name || profile.full_name || "").split(" ")[0] || "us"} />
      )}

      {/* The cheapest lead in the business, and it only happens if somebody
          remembers it exists. Put where everybody starts their day rather
          than four taps into a marketing menu. */}
      <Link
        href="/admin/outreach"
        className="mb-6 flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 transition-colors hover:bg-primary/10"
      >
        <MessageSquarePlus className="h-5 w-5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Someone asked for a landscaper?</span>
          <span className="block text-xs text-muted-foreground">
            Upload the screenshot and get a comment to paste, with your own link in it.
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Link>

      {ops && <OpsPanel state={ops} />}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Visits still to do"
          value={String(summary.evaluationsDue)}
          hint={summary.overdue > 0 ? `${summary.overdue} overdue` : undefined}
          alert={summary.overdue > 0}
        />
        <Tile label="Jobs on site" value={String(summary.jobsOnSite)} />
        <Tile
          label="Needs sign-off"
          value={String(summary.needsSignoff)}
          hint={summary.needsSignoff > 0 ? "Go and walk it" : undefined}
          alert={summary.needsSignoff > 0}
        />
        {/* Booked value moved to the "Jobs you're managing" header, where it
            totals the live work rather than only today's. This slot goes to
            the pile nothing else in the app surfaces. */}
        <Tile
          label="Needs submitting"
          value={String(work?.submissions.length ?? 0)}
          hint={work && work.submissions.length > 0 ? "Visits not written up" : undefined}
          alert={(work?.submissions.length ?? 0) > 0}
        />
      </div>

      {nothing ? (
        <p className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 text-sm text-muted-foreground backdrop-blur-md">
          Nothing on your plate today. Anything overdue would show here, so a quiet screen means a quiet
          day — check the{" "}
          <Link href="/pipeline" className="underline">
            pipeline
          </Link>{" "}
          if you want something to push on.
        </p>
      ) : (
        <>
          <DashboardSections
            title="Today's evaluations"
            blurb="Visits on your clients. Anything still outstanding from before today is pulled in and marked late."
            sections={data.evaluations}
          />

          <DashboardSections
            title="Today's jobs"
            blurb="Your work. Sold-but-unbooked and sign-off piles ignore the date — they matter whenever they exist."
            sections={data.jobs}
          />
        </>
      )}

      {/* The rounds given to this person, above the general to-do list: it is
          their work, with a street and a start button, rather than something
          the business might do. */}
      <MyRoutes plays={playsAssignedTo(marketing.plays, profile.id)} />

            {marketing.plays.length > 0 && (
        <div className="mb-6 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
          <MarketingTodo plays={marketing.plays} reviews={marketing.reviews} autoApproved={marketing.autoApproved} />
        </div>
      )}

      {/* First, because it is the question somebody opens this page with.
          Everything below it is about the week. */}
      {today && <TodayPanel today={withOwed(today, work?.submissions.length ?? 0)} />}

      {work && (
        <>
          <NeedsSubmitting items={work.submissions} />
          <UpcomingEvaluations items={work.upcoming} />
          <ManagedJobs items={work.managed} />
        </>
      )}

      {commission && commission.lines.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-1 text-lg font-bold">Your commission</h2>
          <CommissionPanel
            summary={commission}
            subtitle="Across every client you manage, not just today's."
          />
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        Yours means the client is one you manage, or you are the person assigned to the job. Everything is
        read from the job itself, so it can never disagree with the job page.
      </p>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-3 backdrop-blur-md ${
        alert ? "border-amber-400/70 bg-amber-50/70" : "border-white/60 bg-card/60"
      }`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/**
 * The crew's own day.
 *
 * Was its own page at /today. It is the same question this page answers —
 * what is on me — asked by somebody whose answer is a list of stops rather
 * than a list of jobs, so it lives here and /today redirects in.
 */
/** Whether this person is marked lead on any of today's jobs. */
async function leadsAnyStopToday(profileId: string, jobIds: string[]): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("job_crew").select("job_id").eq("profile_id", profileId).eq("is_lead", true).in("job_id", jobIds).limit(1);
  return (data ?? []).length > 0;
}

async function CrewDay({ profile }: { profile: Profile }) {
  const day = await getCrewDay().catch(() => null);

  if (!day) {
    return (
      <div className="mx-auto max-w-md px-4 py-6">
        <h1 className="mb-1 text-2xl font-bold">Today</h1>
        <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
          Couldn&apos;t load your day. If this is a fresh setup, run{" "}
          <code>supabase/migrations/0082_crew_day.sql</code> and reload.
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
  // Where they stand against the rest of the crew: jobs finished, on time,
  // and what came back. Nothing money on it, so it is theirs to see.
  const boards = await getCrewBoards().catch(() => null);
  const phase = readDay(day.events, day.stops).phase;
  const loading = phase === "before_shop" || phase === "at_shop";

  // The morning at the shop, run from the tablet and followed on every
  // phone: clock in, one kit at a time, the maps, out the door. Shown until
  // this person has left the shop; after that the day board takes over.
  const shopDay = loading ? await getShopDay(day.day).catch(() => null) : null;
  const [dayLoadout, siteMaps, present] = loading
    ? await Promise.all([
        getDayLoadout(day.day, shopDay?.checks ?? []).catch(() => null),
        shopDay && shopDay.stage !== "loadout" ? getSiteMaps(shopDay.shownJobIds).catch(() => []) : Promise.resolve([]),
        whoIsAtTheShop(day.day).catch(() => []),
      ])
    : [null, [], []];
  const leadsAStop = day.stops.length > 0 && (await leadsAnyStopToday(profile.id, day.stops.map((s) => s.jobId)));

  return (
    <div className="mx-auto max-w-md px-4 py-4 sm:py-6">
      {/* Tells the office where this phone is from the shop until the day
          is over, while the app is open. */}
      <LocationBeacon active={phase !== "before_shop" && phase !== "day_over"} />
      {loading && dayLoadout && (
        <div className="mb-4">
          <ShopFlowLive shopDayId={shopDay?.id ?? null} />
          <ShopFlow
            me={{ profileId: profile.id, name: profile.full_name || profile.email, canLead: canLead({ roles: profile.roles, leadsAStop }), arrived: phase !== "before_shop" }}
            shopDay={shopDay}
            loadout={dayLoadout}
            stops={day.stops}
            siteMaps={siteMaps}
            present={present}
          />
        </div>
      )}
      {loadout && loading && !dayLoadout && (
        <div className="mb-4">
          <LoadoutPanel day={day.day} loadout={loadout} />
        </div>
      )}
      <ClockControl
        open={open}
        stops={day.stops.map((stop) => ({
          jobId: stop.jobId,
          sessionId: stop.sessionId,
          name: stop.customerName,
        }))}
      />
      {(!loading || phase === "at_shop") && (
        <TodayBoard
          stops={day.stops}
          events={day.events}
          personName={profile.full_name || profile.email}
          leaveBlockedBy={loading && dayLoadout ? leaveBlockedBy(dayLoadout) : loadout ? leaveBlockedBy(loadout) : null}
        />
      )}
      {loadout && !loading && phase !== "day_over" && (
        <div className="mt-4">
          <LoadoutPanel day={day.day} loadout={loadout} compact />
        </div>
      )}
      {/* Below the board, not above it: this is what to do with the hours
          left over once the board says the day is done. */}
      <div className="mt-4">
        <NextUpCard
          today={day.day}
          visit={day.nextProject}
          existing={day.earlyStart}
          stops={day.stops}
          events={day.events}
        />
      </div>
      {boards && (boards.recent.length > 0 || boards.allTime.length > 0) && (
        <div className="mt-4">
          <CrewLeaderboard boards={boards} meId={profile.id} compact />
        </div>
      )}
    </div>
  );
}

/** Affiliates, evaluators and crew, best first. The money columns are the owner's. */
async function LeaderboardsTab() {
  const viewer = await getCurrentProfile();
  if (!viewer) return null;
  const owner = isOwnerLevel(viewer.roles);
  const [outreach, evaluations, crew] = await Promise.all([
    getOutreachBoard(owner ? {} : { onlyProfileId: viewer.id }).catch(() => null),
    getEvaluationBoards().catch(() => ({ recent: [], allTime: [] })),
    getCrewBoards().catch(() => ({ recent: [], allTime: [] })),
  ]);
  return (
    <div className="mx-auto max-w-4xl">
      <LeaderboardsView
        affiliates={outreach?.standings ?? []}
        evaluations={evaluations}
        crew={crew}
        showMoney={canSeeCompanyMoney(viewer.roles)}
        meId={viewer.id}
      />
    </div>
  );
}

/**
 * What gets texted to you.
 *
 * Was its own page. Personal settings belong on the personal screen, not on
 * a nav entry of their own for something nobody opens twice a year.
 */
async function AlertsTab() {
  let settings: Awaited<ReturnType<typeof getMyNotificationSettings>> = null;
  let migrationMissing = false;
  try {
    settings = await getMyNotificationSettings();
  } catch {
    migrationMissing = true;
  }

  if (migrationMissing) {
    return (
      <p className="rounded-lg border border-white/60 bg-card/60 px-3 py-3 text-sm text-muted-foreground backdrop-blur-md">
        This needs its database migration run first. In Supabase&apos;s SQL Editor, run{" "}
        <code>supabase/migrations/0067_notification_preferences.sql</code>, then reload.
      </p>
    );
  }

  if (!settings) {
    return <p className="text-sm text-muted-foreground">Sign in to manage your alerts.</p>;
  }

  return (
    <div className="max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold">Alerts</h1>
      <p className="mb-6 text-muted-foreground">
        Choose what you want texted to you. These are your settings — nobody else&apos;s.
      </p>
      <NotificationSettings
        preferences={settings.preferences}
        phone={settings.phone}
        smsConfigured={isTwilioConfigured}
        channels={settings.channels}
      />
    </div>
  );
}

/**
 * The owner's Sunday-night screen.
 *
 * Every number is read off the same assessment the Business tab uses, so the
 * two can never disagree about a figure they both show. It fails on its own:
 * a pulse that has not been computed costs this tab and nothing else on the
 * page.
 */
async function GrowthTab() {
  const view = await growthView().catch((err) => {
    console.error("Growth view failed to load:", err);
    return null;
  });
  if (!view) {
    return (
      <p className="text-sm text-muted-foreground">
        The business pulse has not been computed yet, so there is nothing honest to show here.
      </p>
    );
  }
  return (
    <GrowthView
      kpis={view.kpis}
      bottleneck={view.bottleneck}
      weeks={view.weeks}
      ownerHoursTarget={view.ownerHoursTarget}
      canSetTarget
    />
  );
}

/** A tab that has not arrived yet. Quiet: nobody is looking at it. */
function TabLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <div className="h-5 w-48 animate-pulse rounded-md bg-muted" />
      <div className="h-24 animate-pulse rounded-xl border border-border/60 bg-card/40" />
    </div>
  );
}

/**
 * Whose open time to show.
 *
 * A seller sees their own day. Owners and admins see the whole selling
 * team, themselves included when they sell.
 */
async function loadOpenTime(profile: Profile): Promise<{ mine: PersonOpenTime | null; team: PersonOpenTime[] }> {
  const supabase = await createClient();
  const day = dateKeyIn(new Date());
  const team = await sellingTeam(supabase, profile.organization_id);
  const office = isOwnerLevel(profile.roles) || profile.roles.includes("admin");
  const me = team.find((p) => p.id === profile.id) ?? null;
  const mine = me ? await personOpenTime(supabase, me, day) : null;
  if (!office) return { mine, team: [] };
  const rest = await Promise.all(team.filter((p) => p.id !== profile.id).map((p) => personOpenTime(supabase, p, day)));
  return { mine, team: [...(mine ? [mine] : []), ...rest] };
}

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import {
  SAMPLE_JOB_ID,
  SAMPLE_SHOP,
  SAMPLE_STOPS,
  sampleBoard,
  sampleEvents,
  sampleLoadout,
  sampleShopDay,
  sampleSubAreas,
  sampleSubSheet,
  sampleWalkthrough,
  sampleZones,
} from "@/lib/practice-crew";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { JourneyPages, type JourneyStep } from "@/components/practice/journey-pages";
import { WhoDoesIt } from "@/components/job/who-does-it";
import { ShopFlow } from "@/components/crew/shop-flow";
import { TodayBoard } from "@/components/crew/today-board";
import { AreaBoard } from "@/components/job/area-board";
import { WalkthroughPanel } from "@/components/job/walkthrough-panel";
import { SubCrewSheetView } from "@/components/crew/sub-crew-sheet";

/**
 * A signed job from the crew's side, every page, for our own crew and for
 * a subcontractor: who it goes to, the shop and the kits (our crew, or a
 * subcontractor on our tools), on the way, the areas with their during and
 * after photos, finished, and the account manager's walkthrough. The real
 * screens with the sample job; where a screen has no preview of its own it
 * is shown and cannot be tapped, so nothing is recorded.
 */
export const dynamic = "force-dynamic";

/** Shown, not tappable: these screens record the moment they are pressed. */
function Look({ children }: { children: React.ReactNode }) {
  return <div inert>{children}</div>;
}

const SUB = { id: "sub", name: "Green Edge Crew", phone: "4105550199", email: "crew@example.com", usesOurTools: false };
const visit = (subcontractorId: string | null) => [
  { id: "visit", startsOn: new Date().toISOString().slice(0, 10), endsOn: new Date().toISOString().slice(0, 10), subcontractorId, crewToken: subcontractorId ? "sample" : null },
];

export default async function CrewJourneyPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");

  const zones = sampleZones();
  const am = { name: "Jace", phone: "4105550100" };
  const me = { profileId: "me", name: "Jordan", canLead: true };
  const names = { me: "Jordan", am: "Jace" };

  const steps: JourneyStep[] = [
    // ------------------------------------------------------------ our crew
    {
      key: "assign",
      path: "crew",
      title: "Given to our crew",
      what: "Once it is signed, or signed and paid, the office books the visit and picks who does it: our crew.",
      screen: <WhoDoesIt visits={visit(null)} subcontractors={[SUB]} baseUrl="" preview />,
    },
    {
      key: "shop",
      path: "crew",
      title: "Be at the shop",
      what: "Their My Day that morning: the time to be at the shop and the codes to get in. I'm at the shop starts their time.",
      screen: (
        <Look>
          <ShopFlow me={{ ...me, arrived: false }} shopDay={null} loadout={sampleLoadout()} stops={SAMPLE_STOPS} siteMaps={[]} present={[]} shop={SAMPLE_SHOP} />
        </Look>
      ),
    },
    {
      key: "loadout",
      path: "crew",
      title: "Load the kits",
      what: "One kit at a time, with what it travels in and its code, ticked as it goes on the truck.",
      screen: (
        <Look>
          <ShopFlow me={{ ...me, arrived: true }} shopDay={sampleShopDay()} loadout={sampleLoadout()} stops={SAMPLE_STOPS} siteMaps={[]} present={[{ profileId: "me", name: "Jordan" }]} shop={SAMPLE_SHOP} />
        </Look>
      ),
    },
    {
      key: "on-way",
      path: "crew",
      title: "On my way",
      what: "Loaded and out the door: On my way opens directions to the first job.",
      screen: (
        <Look>
          <TodayBoard stops={SAMPLE_STOPS} events={sampleEvents("left_shop")} personName="Jordan" />
        </Look>
      ),
    },
    {
      key: "arrived",
      path: "crew",
      title: "I've arrived",
      what: "At the house: I've arrived opens the crew sheet.",
      screen: (
        <Look>
          <TodayBoard stops={SAMPLE_STOPS} events={sampleEvents("travelling")} personName="Jordan" />
        </Look>
      ),
    },
    {
      key: "areas",
      path: "crew",
      title: "The areas",
      what: "Every area on the job and what to do in it. Each person picks one to start; kits go with the area.",
      screen: (
        <Look>
          <AreaBoard jobId={SAMPLE_JOB_ID} zones={zones} board={sampleBoard("open")} accountManager={am} />
        </Look>
      ),
    },
    {
      key: "during",
      path: "crew",
      title: "Prep done: during photo",
      what: "The prep steps ticked, then the during photo, which unlocks the work.",
      screen: (
        <Look>
          <AreaBoard jobId={SAMPLE_JOB_ID} zones={zones} board={sampleBoard("prep_done")} accountManager={am} />
        </Look>
      ),
    },
    {
      key: "after",
      path: "crew",
      title: "Clean up done: after photo",
      what: "The work and clean up ticked, then the after photo, which finishes the area and frees its kit.",
      screen: (
        <Look>
          <AreaBoard jobId={SAMPLE_JOB_ID} zones={zones} board={sampleBoard("cleanup_done")} accountManager={am} />
        </Look>
      ),
    },
    {
      key: "finished",
      path: "crew",
      title: "Finished",
      what: "Every area has its after photo. They ask for the walkthrough and keep the tools out until it is done.",
      screen: (
        <Look>
          <WalkthroughPanel jobId={SAMPLE_JOB_ID} walkthroughs={[]} canRequest requestLockReason={null} canReview={false} namesById={names} />
        </Look>
      ),
    },
    {
      key: "walk",
      path: "crew",
      title: "The account manager walks it",
      what: "The account manager comes by, walks the whole job and takes any photos, then Approves it or Sends it back.",
      screen: (
        <Look>
          <WalkthroughPanel jobId={SAMPLE_JOB_ID} walkthroughs={[sampleWalkthrough("requested")]} canRequest={false} requestLockReason={null} canReview namesById={names} />
        </Look>
      ),
    },
    {
      key: "sent-back",
      path: "crew",
      missed: "sent-back",
      title: "Sent back",
      what: "What to fix before they leave. Fixed, they ask for the walkthrough again.",
      screen: (
        <Look>
          <WalkthroughPanel jobId={SAMPLE_JOB_ID} walkthroughs={[sampleWalkthrough("rejected")]} canRequest requestLockReason={null} canReview={false} namesById={names} />
        </Look>
      ),
    },

    // ------------------------------------------------------- subcontractor
    {
      key: "sub-assign",
      path: "sub",
      title: "Given to a subcontractor",
      what: "The office picks the subcontractor for the visit and texts or emails them the link to their own crew sheet.",
      screen: <WhoDoesIt visits={visit(SUB.id)} subcontractors={[SUB]} baseUrl="https://app.jslandscapingmd.com" preview />,
    },
    {
      key: "sub-pickup",
      path: "sub",
      missed: "our-tools",
      title: "Pick up at the shop",
      what: "Only for a subcontractor on our tools: the time, the codes to get in, and each kit with its code.",
      screen: <SubCrewSheetView sheet={sampleSubSheet(true)} preview stage="pickup" areaStates={sampleSubAreas("todo")} />,
    },
    {
      key: "sub-go",
      path: "sub",
      title: "Their crew sheet",
      what: "The job, what they will be doing in each area, and On my way, which opens directions.",
      screen: <SubCrewSheetView sheet={sampleSubSheet(false)} preview stage="go" areaStates={sampleSubAreas("todo")} />,
    },
    {
      key: "sub-arrive",
      path: "sub",
      title: "I've arrived",
      what: "At the house, one tap. The job shows as under way in the office.",
      screen: <SubCrewSheetView sheet={sampleSubSheet(false)} preview stage="on_way" areaStates={sampleSubAreas("todo")} />,
    },
    {
      key: "sub-areas",
      path: "sub",
      title: "The areas: during photo",
      what: "Each area with what to do, the evaluation photos, and the during photo once the prep is done.",
      screen: <SubCrewSheetView sheet={sampleSubSheet(false)} preview stage="on_site" areaStates={sampleSubAreas("todo")} />,
    },
    {
      key: "sub-after",
      path: "sub",
      title: "After photo",
      what: "Prepped areas ask for the after photo once cleaned up, which finishes them.",
      screen: <SubCrewSheetView sheet={sampleSubSheet(false)} preview stage="on_site" areaStates={sampleSubAreas("first_prepped")} />,
    },
    {
      key: "sub-finish",
      path: "sub",
      title: "We're finished",
      what: "Every area has its after photo: We're finished asks the account manager to come and walk it.",
      screen: <SubCrewSheetView sheet={sampleSubSheet(false)} preview stage="on_site" areaStates={sampleSubAreas("all_done")} />,
    },
    {
      key: "sub-waiting",
      path: "sub",
      title: "Waiting on the walkthrough",
      what: "Their sheet says the account manager is coming, and to keep the tools out until then.",
      screen: <SubCrewSheetView sheet={sampleSubSheet(false, { status: "requested", notes: null })} preview stage="finished" areaStates={sampleSubAreas("all_done")} />,
    },
    {
      key: "sub-walk",
      path: "sub",
      title: "The account manager walks it",
      what: "The same walkthrough as for our crew: Approve, or Send back with what to fix.",
      screen: (
        <Look>
          <WalkthroughPanel jobId={SAMPLE_JOB_ID} walkthroughs={[sampleWalkthrough("requested", true)]} canRequest={false} requestLockReason={null} canReview namesById={names} />
        </Look>
      ),
    },
    {
      key: "sub-sent-back",
      path: "sub",
      missed: "sub-sent-back",
      title: "Sent back",
      what: "Their sheet lists what to fix. Fixed it, walk it again asks for the walkthrough again.",
      screen: (
        <SubCrewSheetView
          sheet={sampleSubSheet(false, { status: "rejected", notes: sampleWalkthrough("rejected").review_notes })}
          preview
          stage="finished"
          areaStates={sampleSubAreas("all_done")}
        />
      ),
    },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <Link href="/my-day?tab=system" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> The system
      </Link>
      <header>
        <h1 className="text-xl font-bold">The crew sheet, every page</h1>
        <p className="text-sm text-muted-foreground">
          Everything the crew do on site, from who&apos;s doing it and the tools they need through to the account manager&apos;s
          walkthrough, for our own crew or a subcontractor, with the sample job. Signing off and sending the before and afters to the client is the next step, not this one. Nothing
          here is recorded or sent.
        </p>
      </header>
      <JourneyPages
        steps={steps}
        paths={[
          { key: "crew", label: "Our crew" },
          { key: "sub", label: "Subcontractor" },
        ]}
        missed={[
          { key: "sent-back", label: "The account manager sends it back", path: "crew" },
          { key: "our-tools", label: "They use our tools", path: "sub" },
          { key: "sub-sent-back", label: "The account manager sends it back", path: "sub" },
        ]}
        heading="Add the pages for when it goes another way"
      />
    </div>
  );
}

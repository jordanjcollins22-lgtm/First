import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { listBusinessLocations } from "@/lib/data/locations";
import { getCurrentOrganization } from "@/lib/data/organizations";
import { getCurrentProfile } from "@/lib/data/team";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { fetchLotFromCounty } from "@/lib/data/lot-map";
import { cleanAnswers } from "@/lib/evaluation-intake";
import { dayIn, seedPlan, type VisitStage } from "@/lib/evaluation-visit";
import { zonedToUtc } from "@/lib/time-zone";
import type { EvaluatorDay, Visit } from "@/lib/data/evaluator-day";
import type { JobWithLocation } from "@/lib/data/jobs";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { EvaluationsView } from "@/components/evaluations/evaluations-view";
import { EvaluatorDayView } from "@/components/evaluations/evaluator-day-view";
import { VisitHeader } from "@/components/evaluations/visit-header";
import { SiteMapSetup } from "@/components/evaluations/site-map-setup";
import { PreEvalFirst } from "@/components/evaluations/pre-eval-first";
import { IntakeForm } from "@/components/intake/intake-form";
import { YourPlan } from "@/components/intake/your-plan";

/**
 * The evaluator's side of a visit, every page in order, with a sample
 * client: how it lands on their calendar, their day, the buttons, what the
 * client sent, the site map already set up from it, and, when the client
 * never filled it out, the pre-eval done together first. The same
 * screens they use, in preview: nothing is recorded, saved or sent.
 */
export const dynamic = "force-dynamic";

const SAMPLE_PHOTOS = [
  { path: "demo/intake-front-1.jpg", url: "/booking-work/front-bed-mulch-trim.jpg", area: "front" },
  { path: "demo/intake-front-2.jpg", url: "/booking-work/bed-edging-mulch.jpg", area: "front" },
  { path: "demo/intake-back-1.jpg", url: "/booking-work/leaf-cleanup.jpg", area: "back" },
];

const ANSWERS = cleanAnswers({
  services: ["beds", "cleanup", "washing"],
  areas: ["front", "back"],
  looks: ["classic"],
  details: {
    beds_now: ["stone", "weeds"],
    beds_add: ["mulch", "plants"],
    mulch_color: "brown",
    cleanup_what: ["leaves", "trim"],
    wash_what: ["siding"],
    stories: "2",
  },
  photos: SAMPLE_PHOTOS.map((p) => p.path),
  photo_areas: Object.fromEntries(SAMPLE_PHOTOS.map((p) => [p.path, p.area])),
  questions: "Can you also look at the gutters?",
});

/** Today at 10am where the business is, and days either side of now. */
function sampleTimes(timeZone: string) {
  const now = Date.now();
  const on = (days: number) => dayIn(new Date(now + days * 86_400_000), timeZone);
  return {
    at: zonedToUtc(on(0), "10:00", timeZone).toISOString(),
    later: (days: number, time: string) => zonedToUtc(on(days), time, timeZone).toISOString(),
    rangeStart: on(-30),
    rangeEnd: on(90),
  };
}

export default async function EvaluatorJourneyPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");

  const [places, organization, viewer, catalog] = await Promise.all([
    listBusinessLocations().catch(() => []),
    getCurrentOrganization().catch(() => null),
    getCurrentProfile(),
    getCanvasCatalog(),
  ]);
  const timeZone = organization?.reminder_time_zone || "America/New_York";
  const shop = places.find((p) => /shop/i.test(p.name) && p.lat != null && p.lng != null) ?? null;
  const lot = shop ? await fetchLotFromCounty(shop.lat, shop.lng, shop.address ?? "").catch(() => null) : null;

  // A sample visit at the shop's own address, today at 10am.
  const { at, later, rangeStart, rangeEnd } = sampleTimes(timeZone);
  const address = shop?.address || "123 Example Lane, Bel Air, MD";
  const when = new Date(at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone });

  const visit = (stage: VisitStage): Visit => ({
    id: "sample",
    evaluationDate: at,
    evaluationStatus: stage === "on_way" ? "on_way" : stage === "arrived" ? "arrived" : stage === "submitted" ? "completed" : "scheduled",
    jobStatus: "estimating",
    stage,
    clientName: "Sarah Miller",
    phone: "4105550100",
    address,
    formSent: true,
    evaluatorName: null,
  });
  const dayWith = (stage: VisitStage): EvaluatorDay => ({
    today: [visit(stage)],
    upcoming: [
      { ...visit("booked"), id: "sample-2", clientName: "Tom Reed", address: "9 Oak Ct, Fallston, MD", evaluationDate: later(1, "13:00"), formSent: false },
      { ...visit("booked"), id: "sample-3", clientName: "Ana Lopez", address: "44 Mill Rd, Forest Hill, MD", evaluationDate: later(3, "09:30") },
    ],
    toWriteUp: [],
    timeZone,
    everyone: false,
    canSeeEveryone: false,
  });

  // The calendar, with the sample visit on it.
  const calendarJob = {
    id: "sample",
    status: "estimating",
    evaluation_date: at,
    evaluation_status: "scheduled",
    assigned_to: viewer?.id ?? null,
    property: { address, lat: shop?.lat ?? null, lng: shop?.lng ?? null, customer: { name: "Sarah Miller" } },
  } as unknown as JobWithLocation;

  const active = catalog.servicePricing.filter((p) => p.status === "active");
  const findByName = (pattern: RegExp) => active.find((p) => pattern.test(p.name))?.service_type_id ?? null;
  const plan = seedPlan(ANSWERS, findByName);
  const services = active.map((p) => ({ typeId: p.service_type_id, name: p.name }));
  const photos = SAMPLE_PHOTOS.map(({ path, url }) => ({ path, url }));

  const setupProps = {
    jobId: "sample",
    services,
    catalog,
    design: null,
    address,
    lat: shop?.lat ?? null,
    lng: shop?.lng ?? null,
    evaluationStatus: "arrived" as const,
    evaluatorName: viewer?.full_name || null,
    preview: true,
    demoLot: lot,
  };

  const steps: { title: string; what: string; screen: React.ReactNode }[] = [
    {
      title: "On their calendar",
      what: "Booked online or by the office, it shows on their calendar in the app and in HighLevel.",
      screen: (
        <EvaluationsView
          overdue={[]}
          upcoming={[calendarJob]}
          past={[]}
          allRelevantJobs={[calendarJob]}
          scheduledJobs={[]}
          workSessions={new Map()}
          currentProfileId={viewer?.id ?? ""}
          allWeeklyAvailability={[1, 2, 3, 4, 5].map((day) => ({
            id: `sample-${day}`,
            organization_id: "",
            profile_id: viewer?.id ?? "",
            day_of_week: day,
            start_time: "08:00",
            end_time: "17:00",
            created_at: "",
            updated_at: "",
          }))}
          allDaysOff={[]}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
        />
      ),
    },
    {
      title: "The day of",
      what: "Today's visit, and whether the client filled out the pre-eval. On my way opens directions.",
      screen: <EvaluatorDayView data={dayWith("booked")} preview />,
    },
    {
      title: "On the way",
      what: "They tap I've arrived when they pull up. The arrow undoes a mis-tap.",
      screen: <EvaluatorDayView data={dayWith("on_way")} preview />,
    },
    {
      title: "Arrived",
      what: "The visit opens with what the client sent: their lot, photos and what they want done.",
      screen: (
        <div className="flex flex-col gap-4">
          <VisitHeader jobId="sample" when={when} client="Sarah Miller" address={address} phone="4105550100" stage="arrived" arrivedAt={at} timeZone={timeZone} preview />
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-lg font-semibold">What they asked for</p>
            <div className="mt-3">
              <YourPlan answers={ANSWERS} photos={photos} lot={lot} />
            </div>
          </div>
        </div>
      ),
    },
    {
      title: "The site map",
      what: "Already set up from their pre-eval: every piece of work on the map. Remove or add, measure, Submit.",
      screen: <SiteMapSetup {...setupProps} initialPlan={plan} />,
    },
    {
      title: "No pre-eval yet",
      what: "If they never filled it out, the first thing on arrival is the pre-eval, with them.",
      screen: (
        <div className="flex flex-col gap-4">
          <VisitHeader jobId="sample" when={when} client="Tom Reed" address="9 Oak Ct, Fallston, MD" phone="4105550100" stage="arrived" arrivedAt={at} timeZone={timeZone} preview />
          <PreEvalFirst formHref="#" skipHref="#" preview />
        </div>
      ),
    },
    {
      title: "The pre-eval, together",
      what: "The client's own form, marked as filled out on the visit. When it is sent, the site map is set up from it.",
      screen: (
        <IntakeForm
          token={"0".repeat(24)}
          initial={cleanAnswers({})}
          initialPhotos={[]}
          submittedAt={null}
          together
          businessPhone={null}
          demo
          lot={lot}
          showStaffPrice={false}
        />
      ),
    },
    {
      title: "Submitted",
      what: "Submit on the map writes the proposal, and the visit shows as done on their day.",
      screen: <EvaluatorDayView data={dayWith("submitted")} preview />,
    },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <Link href="/my-day?tab=system" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> The system
      </Link>
      <header>
        <h1 className="text-xl font-bold">The evaluator&apos;s visit, every page</h1>
        <p className="text-sm text-muted-foreground">
          What an evaluator sees, in order, with a sample client at the shop&apos;s address. These are the real screens in preview:
          the buttons can be tapped and nothing is recorded, saved or sent. Evaluators find theirs on My Day, or at{" "}
          <span className="font-mono">/evaluate</span>.
        </p>
      </header>

      {/* The same frames as the pre-evaluation form's pages: one phone
          screen each, all one size, scrolled inside. */}
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="flex flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Page {i + 1} of {steps.length}
              <span className="rounded-full bg-muted px-2 py-0.5 normal-case tracking-normal">{step.title}</span>
            </p>
            <p className="min-h-8 text-xs leading-snug text-muted-foreground">{step.what}</p>
            <div className="relative flex h-[640px] flex-col overflow-y-auto rounded-2xl border border-border bg-background px-4 pt-4 pb-4 shadow-sm">
              {step.screen}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

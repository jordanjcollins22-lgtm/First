import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { priceBreakdown } from "@/lib/price-approval";
import { PRACTICE_ADDRESS, PRACTICE_ZONES, practicePriceCents } from "@/lib/practice-sample";
import type { PriceApproval } from "@/lib/data/price-approvals";
import type { WorkZone } from "@/components/canvas/types";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PriceApprovals, PriceCard } from "@/components/proposal/price-approvals";
import { JourneyPages, type JourneyStep } from "@/components/practice/journey-pages";
import { AccountManagerDayView } from "@/components/dashboard/account-manager-day";
import { EvaluatorDayView } from "@/components/evaluations/evaluator-day-view";
import { CommentCard } from "@/components/marketing/comment-card";
import type { BoardPost } from "@/lib/data/post-board";

/**
 * The account manager's side, once a walkthrough is submitted: it lands on
 * their My Day to price, with everything behind the price; Accept price;
 * then Review proposal and Send to client, the last step. Decline price,
 * for when the price is wrong, is added from the chip at the top. A sample job
 * priced on the business's own rate card, in preview: nothing is priced,
 * saved or sent.
 */
export const dynamic = "force-dynamic";

const zone = (name: string, typeId: string, areaSqFt: number, values: Record<string, string> = {}): WorkZone => ({
  id: name,
  name,
  color: "#16a34a",
  points: [],
  location: "",
  service: { typeId, values, notes: "", photos: [], tools: [] },
  areaSqFt,
  perimeterFt: Math.round(Math.sqrt(areaSqFt) * 4),
  measurementKind: "area",
});

const SAMPLE_PHOTOS = [
  ["/booking-work/front-bed-mulch-trim.jpg", "/booking-work/bed-edging-mulch.jpg"],
  ["/booking-work/overgrowth-removal-mulch.jpg"],
];

/** A moment this many hours from now, for the sample visits and post. */
function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

export default async function AccountManagerJourneyPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");

  const catalog = await getCanvasCatalog();
  // The sample job: the same three areas, and the same price, as the sample
  // proposal Review proposal opens, priced on this business's own rate card.
  const typeFor = (name: string) => catalog.servicePricing.find((p) => p.name === name)?.service_type_id ?? null;
  const sizeOf = (label: string) => {
    const [l, w] = label.split("×").map((n) => parseFloat(n));
    return Number.isFinite(l) && Number.isFinite(w) ? l * w : 0;
  };
  const zones = PRACTICE_ZONES.flatMap((z): WorkZone[] => {
    const typeId = typeFor(z.service);
    if (!typeId) return [];
    const area = sizeOf(z.sizeLabel);
    return [
      {
        ...zone(z.name, typeId, area, z.service === "Landscape Bed" ? { material: "Mulch" } : { quantity: "2" }),
        color: z.color,
        points: z.points,
        areaSqFt: area || null,
        perimeterFt: area ? Math.round(Math.sqrt(area) * 4) : null,
      },
    ];
  });
  const breakdown = priceBreakdown(zones, catalog);
  const m = catalog.markup;
  const item: PriceApproval = {
    jobId: "sample",
    client: "Sarah Miller",
    address: PRACTICE_ADDRESS,
    email: "sarah@example.com",
    evaluator: "Jace",
    submittedAt: new Date().toISOString(),
    stage: "price",
    totalCents: PRACTICE_ZONES.reduce((sum, z) => sum + practicePriceCents(z), 0),
    // The sample job's proposal as the client sees it, for Review proposal.
    proposalHref: "/practice/proposal/client",
    breakdown,
    crewRateCents: catalog.crewCostPerHourCents,
    markup:
      m.overheadPerCrewHourCents != null && m.overheadPerCrewHourCents > 0
        ? `× ${m.multiplier}, then + $${(m.overheadPerCrewHourCents / 100).toFixed(2)} a crew-hour overhead`
        : `× ${m.multiplier}, then + ${m.overheadPercent}% overhead`,
    // Sample walkthrough photos, one area without any.
    areaPhotos: breakdown.areas.map((_, i) => SAMPLE_PHOTOS[i] ?? []),
    siteMap: { kind: "sample", zones: PRACTICE_ZONES.map((z) => ({ name: z.name, color: z.color, points: z.points })) },
  };

  // Jace's My Day: the three squares, each opening on a sample of what is in it.
  const at = hoursFromNow;
  const visit = (id: string, clientName: string, address: string, when: string, formSent: boolean) => ({
    id,
    evaluationDate: when,
    evaluationStatus: "scheduled",
    jobStatus: "estimating",
    stage: "booked" as const,
    clientName,
    phone: "4105550100",
    address,
    formSent,
    evaluatorName: null,
  });
  const sampleDay = {
    today: [visit("sample-1", "Sarah Miller", PRACTICE_ADDRESS, at(2), true)],
    upcoming: [visit("sample-2", "Tom Reed", "9 Oak Ct, Fallston, MD", at(26), false)],
    toWriteUp: [{ ...visit("sample-3", "Ana Lopez", "44 Mill Rd, Forest Hill, MD", at(-30), true), evaluationStatus: "arrived" }],
    timeZone: "America/New_York",
    everyone: false,
    canSeeEveryone: false,
  };
  const samplePost: BoardPost = {
    id: "sample-post",
    link: "#",
    hasUrl: false,
    groupName: "Bel Air Neighbors",
    author: "Megan Carter",
    text: "Can anyone recommend someone to clean up and mulch our front beds before the fall? Looking to get it done in the next couple of weeks.",
    ageDays: 0,
    foundAt: at(-2),
    pile: "open",
    mine: null,
    others: [],
    platform: "facebook",
    postedAt: at(-3),
    matchReason: "Asking for bed clean up and mulch",
    addedByHand: false,
    draft: "@Megan we'd be glad to help. Jace here from JS Landscaping, we do bed clean ups and mulch around Bel Air. You can book a free evaluation here: [your link]",
    ageLabel: "Posted 3 hours ago",
    freshness: "fresh",
    ageHint: "Fresh: answer it today.",
  };
  const myDay = (open: string) => (
    <AccountManagerDayView
      preview
      initialOpen={open}
      squares={[
        { key: "comments", title: "Commenting", count: 3, line: "posts to answer" },
        { key: "evaluations", title: "Evaluations", count: 1, line: "today · 1 to write up" },
        { key: "approval", title: "Site map approval", count: 1, line: "to price" },
      ]}
      sections={{
        // The card as Jace sees it; in the preview it can't be pressed, so nothing is taken or posted.
        comments: (
          <div inert>
            <CommentCard posts={[samplePost]} pinned={null} answeredToday={2} dailyLimit={10} owner={false} />
          </div>
        ),
        evaluations: <EvaluatorDayView data={sampleDay} preview />,
        approval: <PriceApprovals items={[item]} preview />,
      }}
    />
  );

  const steps: JourneyStep[] = [
    {
      key: "my-day",
      title: "Jace's My Day",
      what: "Three squares and nothing else: Commenting, Evaluations and Site map approval, each with what is waiting. Tap one to open it underneath.",
      screen: myDay("approval"),
    },
    {
      key: "to-price",
      title: "It lands on My Day",
      what: "A submitted walkthrough, from an evaluator or their own, with the price and everything behind it. Accept price.",
      screen: <PriceApprovals items={[item]} preview />,
    },
    {
      key: "decline",
      missed: "price-wrong",
      title: "Decline price",
      what: "Decline asks for the price. They type it and Submit, and it is spread across the areas so they add up.",
      screen: <PriceCard item={item} preview startAt="decline" />,
    },
    {
      key: "send",
      title: "Review proposal, send to client",
      what: "The last step: Review proposal opens it as the client will see it, then Send to client emails it.",
      screen: <PriceCard item={item} preview startAt="send" />,
    },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <Link href="/my-day?tab=system" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> The system
      </Link>
      <header>
        <h1 className="text-xl font-bold">The account manager&apos;s day and pricing, every page</h1>
        <p className="text-sm text-muted-foreground">
          Jace&apos;s My Day, then what an account manager sees once a walkthrough is submitted, with a sample job priced on your own rate card. Pick
          &ldquo;The price needs changing&rdquo; at the top to add Decline price. These are the real screens in preview: the buttons
          can be tapped and nothing is priced, saved or sent.
        </p>
      </header>
      <JourneyPages
        steps={steps}
        missed={[{ key: "price-wrong", label: "The price needs changing" }]}
        heading="Add the pages for when something needs fixing"
      />
    </div>
  );
}

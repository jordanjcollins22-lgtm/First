import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { priceBreakdown } from "@/lib/price-approval";
import type { PriceApproval } from "@/lib/data/price-approvals";
import type { WorkZone } from "@/components/canvas/types";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { PriceApprovals, PriceCard } from "@/components/proposal/price-approvals";
import { JourneyPages, type JourneyStep } from "@/components/practice/journey-pages";

/**
 * The account manager's side, once a walkthrough is submitted: it lands on
 * their My Day to price, with everything behind the price; Accept price, or
 * Decline price and type the price; then Send to client. A sample job
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

export default async function AccountManagerJourneyPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");

  const catalog = await getCanvasCatalog();
  const has = (id: string) => catalog.servicePricing.some((p) => p.service_type_id === id && p.status === "active");
  // A sample walkthrough, priced on this business's own rate card.
  const zones = [
    has("landscape-bed") && zone("Front yard · Beds: mulch", "landscape-bed", 450, { material: "Mulch" }),
    has("landscape-bed") && zone("Back yard · Beds: mulch", "landscape-bed", 300, { material: "Mulch" }),
    has("landscape-cleanup") && zone("Back yard · Cleanup", "landscape-cleanup", 1200),
    has("soft-washing") && zone("The property · Soft washing", "soft-washing", 1800),
  ].filter(Boolean) as WorkZone[];
  const breakdown = priceBreakdown(zones, catalog);
  const m = catalog.markup;
  const item: PriceApproval = {
    jobId: "sample",
    client: "Sarah Miller",
    address: "123 Example Lane, Bel Air, MD",
    email: "sarah@example.com",
    evaluator: "Jace",
    submittedAt: new Date().toISOString(),
    stage: "price",
    // The rate card's figure, or a round sample one when the rate card has nothing to go on.
    totalCents: breakdown.priceCents > 0 ? breakdown.priceCents : 245000,
    proposalHref: null,
    breakdown,
    crewRateCents: catalog.crewCostPerHourCents,
    markup:
      m.overheadPerCrewHourCents != null && m.overheadPerCrewHourCents > 0
        ? `× ${m.multiplier}, then + $${(m.overheadPerCrewHourCents / 100).toFixed(2)} a crew-hour overhead`
        : `× ${m.multiplier}, then + ${m.overheadPercent}% overhead`,
  };

  const steps: JourneyStep[] = [
    {
      key: "to-price",
      title: "It lands on My Day",
      what: "A submitted walkthrough, from an evaluator or their own, under To price with the price and everything behind it.",
      screen: <PriceApprovals items={[item]} preview />,
    },
    {
      key: "decline",
      title: "Decline price",
      what: "Decline asks for the price. They type it and Submit. It is spread across the areas so they add up.",
      screen: <PriceCard item={item} preview startAt="decline" />,
    },
    {
      key: "send",
      title: "Send to client",
      what: "Accepted or set, the price is ready. Send to client emails the proposal. See what they see first.",
      screen: <PriceCard item={item} preview startAt="send" />,
    },
    {
      key: "sent",
      title: "Sent",
      what: "It is with the client, on their proposal page, to accept and pay.",
      screen: <PriceCard item={item} preview startAt="sent" />,
    },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6">
      <Link href="/my-day?tab=system" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> The system
      </Link>
      <header>
        <h1 className="text-xl font-bold">The account manager&apos;s pricing, every page</h1>
        <p className="text-sm text-muted-foreground">
          What an account manager sees once a walkthrough is submitted, with a sample job priced on your own rate card. These are
          the real screens in preview: the buttons can be tapped and nothing is priced, saved or sent.
        </p>
      </header>
      <JourneyPages steps={steps} missed={[]} />
    </div>
  );
}

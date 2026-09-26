import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";

/**
 * The site map tool with no job behind it, to see it and try it.
 *
 * The same tool the evaluator uses on the property, with the same services
 * and materials to pick from, but nothing is saved: not to a job, not to the
 * database, not even in this browser. Leave the page and it is gone. Above
 * it, how it is used, in the order the tool itself asks for things.
 */
export const dynamic = "force-dynamic";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Find the property",
    body: "Type the address and the satellite photo of the lot loads. With no signal, upload a photo instead.",
  },
  {
    title: "Turn it so the front faces up",
    body: "Drag until the front of the house faces the arrow, then lock the background so it cannot move while you draw.",
  },
  {
    title: "Mark the house",
    body: "Tap once on the house to drop a pin on it.",
  },
  {
    title: "Draw the property line",
    body: "Tap around the edge of the lot, one point at a time.",
  },
  {
    title: "Draw each work zone",
    body: "Tap Draw Work Zone and tap its corners. It measures itself: square feet for an area, feet for an edge or a path.",
  },
  {
    title: "Say what each zone needs",
    body: "Tap a zone to pick the service, the material and colour, add photos of it and notes for the crew.",
  },
  {
    title: "Submit the evaluation",
    body: "On a real job, Submit builds the proposal from the zones, each one a priced line, and the crew sheet from the same map. Practice has no Submit, because there is no job.",
  },
];

export default async function SiteMapPracticePage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");
  const catalog = await getCanvasCatalog();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6">
      <div>
        <Link href="/my-day?tab=system" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
          <ChevronLeft className="h-3.5 w-3.5" /> The system
        </Link>
        <h1 className="mt-1 text-xl font-semibold">Site map: practice</h1>
        <p className="text-sm text-muted-foreground">
          The tool the evaluator uses on the property. Try anything: nothing here is saved, and leaving the page clears it.
        </p>
      </div>

      <details className="group rounded-xl border border-border bg-card p-4" open>
        <summary className="cursor-pointer list-none text-sm font-semibold [&::-webkit-details-marker]:hidden">
          How it is used <span className="font-normal text-muted-foreground">(tap to hide)</span>
        </summary>
        <ol className="mt-3 grid gap-3 sm:grid-cols-2">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                {i + 1}
              </span>
              <span>
                <span className="block text-sm font-semibold">{step.title}</span>
                <span className="block text-sm text-muted-foreground">{step.body}</span>
              </span>
            </li>
          ))}
        </ol>
      </details>

      <ImageCanvasBoard catalog={catalog} practice />
    </div>
  );
}

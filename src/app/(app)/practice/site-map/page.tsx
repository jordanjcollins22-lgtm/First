import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { ImageCanvasBoard } from "@/components/canvas/image-canvas-board";
import { JobSections } from "@/components/job/job-sections";
import { IntakeSummary } from "@/components/intake/intake-summary";
import { cleanAnswers, intakeHeadline } from "@/lib/evaluation-intake";

/**
 * The evaluator's screen on an evaluation, with no job behind it.
 *
 * Laid out the way the evaluator sees a real one: the address at the top,
 * then the job's panels, one open at a time. What the client asked for, with
 * a sample client's pre-evaluation answers and the notes for the walk; the
 * site map tool, open, with the business's own services and materials; and
 * the proposal, waiting on Submit. Nothing is saved: not to a job, not to the
 * database, not even in this browser. Above it, how the tool is used.
 */
export const dynamic = "force-dynamic";

/** A made-up client's answers, so the panel reads the way a real one does. */
const SAMPLE_ANSWERS = cleanAnswers({
  services: ["beds", "removal"],
  areas: ["front", "foundation"],
  details: {
    beds_now: ["old_mulch", "weeds"],
    beds_add: ["mulch", "plants"],
    mulch_color: "black",
    remove_what: ["large"],
    yard: ["sprinklers"],
  },
  looks: ["low"],
  concerns: ["price"],
  tried: "Planted boxwoods two years ago and half of them died.",
  budget: "2500_5000",
  timing: "season",
  decision: "others",
  people: [{ name: "Mike", role: "Husband", contact: "410 555 0100" }],
});
const SAMPLE_SENT_AT = "2026-09-24T14:00:00Z";

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
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:py-10">
      <Link href="/my-day?tab=system" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
        <ChevronLeft className="h-3.5 w-3.5" /> The system
      </Link>

      <p className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
        <span className="font-semibold">Practice.</span> This is the evaluator&apos;s screen on an evaluation, with a sample client. Nothing
        here is saved, and leaving the page clears it.
      </p>

      {/* The job's own header, as the evaluator sees it. */}
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">12 Example Court, Bel Air, Maryland 21014</h1>
        <p className="text-sm text-muted-foreground sm:text-base">Sample client · Evaluation</p>
      </div>

      <details className="rounded-xl border border-border bg-card/60 px-4 py-3">
        <summary className="cursor-pointer list-none text-sm font-semibold [&::-webkit-details-marker]:hidden">
          How the site map is used <span className="font-normal text-muted-foreground">(tap to open)</span>
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

      <JobSections
        defaultOpen="map"
        sections={[
          {
            id: "request",
            title: "What the client asked for",
            hint: intakeHeadline(SAMPLE_ANSWERS, SAMPLE_SENT_AT),
            // "demo" makes its Change an answer link the form's demo page.
            body: <IntakeSummary answers={SAMPLE_ANSWERS} submittedAt={SAMPLE_SENT_AT} submittedBy="client" token="demo" />,
          },
          {
            id: "map",
            title: "Site map and measurements",
            hint: "Practice: closing this clears the drawing",
            body: <ImageCanvasBoard catalog={catalog} practice />,
          },
          {
            id: "proposal",
            title: "Proposal",
            hint: null,
            lockedReason: "Built from the site map when the evaluator submits it",
            body: null,
          },
        ]}
      />
    </div>
  );
}

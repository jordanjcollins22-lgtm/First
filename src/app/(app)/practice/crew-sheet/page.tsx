import Link from "next/link";
import { ArrowRight, ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { crewInstructions } from "@/lib/crew-instructions";
import { requireTab } from "@/lib/data/access";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { WorkOrderView } from "@/components/job/work-order-view";
import { PRACTICE_ADDRESS, PRACTICE_ZONES, practiceWorkOrder } from "@/lib/practice-sample";

/**
 * How the site map and the proposal become the crew sheet, on the same
 * sample job as the other two practice pages.
 *
 * The sheet itself, as the crew opens it on a phone, beside what went into
 * it: each zone as the proposal says it, and the same zone as the crew read
 * it. Nothing here is a real job, and nothing can be changed.
 */
export const dynamic = "force-dynamic";

const STEPS: { title: string; body: string }[] = [
  {
    title: "The same site map",
    body: "The crew sheet is built from the zones the evaluator drew. Every zone with a service becomes a numbered area, on the satellite map with its shape drawn on it.",
  },
  {
    title: "The evaluator's answers become the instructions",
    body: "For each area: the service, where it is, its size, the checklist answers from the site map, the notes, and the photos with the evaluator's pins on them.",
  },
  {
    title: "The work, never the money",
    body: "The proposal is what the client buys, with prices. The sheet is the same work for the crew, with no prices on it.",
  },
  {
    title: "Anything added later is kept apart",
    body: "Extra work the client agrees to after accepting shows under Added since, approved, so the crew can tell what was sold from what was added.",
  },
  {
    title: "On the day",
    body: "The crew opens the job from My Day, taps Arrived, and the sheet walks them through one area at a time, each finished with an after photo from the evaluator's angle.",
  },
];

export default async function CrewSheetPracticePage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:py-10">
      <Link href="/my-day?tab=system" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
        <ChevronLeft className="h-3.5 w-3.5" /> The system
      </Link>

      <p className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
        <span className="font-semibold">Practice.</span> The same sample job as the{" "}
        <Link href="/practice/site-map" className="underline underline-offset-2">site map</Link> and{" "}
        <Link href="/practice/proposal" className="underline underline-offset-2">proposal</Link> practice, now as the crew&apos;s sheet. Nothing here is a real job.
      </p>

      <div>
        <h1 className="text-xl font-bold sm:text-2xl">From site map and proposal to crew sheet</h1>
        <p className="text-sm text-muted-foreground">{PRACTICE_ADDRESS}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-5">
          <ol className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-4">
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

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">The site map</h2>
            <SampleMap />
            <p className="text-xs text-muted-foreground">On a real sheet the shapes sit on the satellite photo of the property.</p>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Each zone, from proposal to sheet</h2>
            <ul className="flex flex-col gap-2">
              {PRACTICE_ZONES.map((z, i) => (
                <li key={z.id} className="grid items-stretch gap-2 rounded-xl border border-border p-2.5 text-sm sm:grid-cols-[1fr_auto_1fr]">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Proposal line (client sees)</p>
                    <p className="font-semibold">
                      {z.name} <span className="font-normal text-muted-foreground">· {z.service}</span>
                    </p>
                    <p className="text-muted-foreground">{z.notes}</p>
                  </div>
                  <ArrowRight className="hidden h-4 w-4 self-center text-muted-foreground sm:block" aria-hidden />
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Crew sheet area {i + 1} (crew sees)</p>
                    <p className="font-semibold">
                      {z.service} <span className="font-normal text-muted-foreground">· {z.location}, {z.sizeLabel}</span>
                    </p>
                    <ol className="list-decimal pl-4 text-muted-foreground">
                      {crewInstructions(z.typeId, z.values).map((line, n) => (
                        <li key={n}>{line}</li>
                      ))}
                    </ol>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* The sheet as the crew see it, in a phone-sized frame. */}
        <div>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The crew sheet, on their phone</h2>
          <div className="overflow-hidden rounded-[2rem] border-4 border-foreground/80 bg-background">
            <WorkOrderView
              practice
              bare
              jobId="practice"
              jobNumber={null}
              order={practiceWorkOrder()}
              address={PRACTICE_ADDRESS}
              customerName="Sample client"
              jobName="Beds and removal"
              siteImagePath={null}
              imageTransform={null}
              marks={[]}
              photos={[]}
              photoZones={[]}
              photoMarks={[]}
              photosApprovedAt={null}
              waivers={[]}
              jobStatus="approved"
              allowDuring={false}
              allowAfter={false}
              allowSignOff={false}
              signOffLockReason={null}
              lockedStageReason={null}
              completedAt={null}
              completedByName={null}
              completionNotes={null}
              accountManager={null}
              approvedAdditions={[]}
              back={{ href: "/my-day?tab=system", label: "Back to The system" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** The sample zones, numbered the way the sheet numbers them. */
function SampleMap() {
  return (
    <svg viewBox="0 0 400 260" className="w-full rounded-xl border border-border bg-emerald-50 dark:bg-emerald-950/30" role="img" aria-label="Sample site map with three numbered areas">
      <rect x="110" y="50" width="180" height="130" rx="4" className="fill-stone-300 dark:fill-stone-700" />
      <text x="200" y="120" textAnchor="middle" className="fill-stone-600 text-[12px] dark:fill-stone-300">House</text>
      {PRACTICE_ZONES.map((z, i) => {
        const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
        const cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
        return (
          <g key={z.id}>
            <polygon points={z.points.map((p) => `${p.x},${p.y}`).join(" ")} fill={z.color} fillOpacity={0.35} stroke={z.color} strokeWidth={2} />
            <circle cx={cx} cy={cy} r={10} fill={z.color} />
            <text x={cx} y={cy + 4} textAnchor="middle" className="fill-white text-[11px] font-bold">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

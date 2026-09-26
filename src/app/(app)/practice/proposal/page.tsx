import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { isSupabaseConfigured } from "@/lib/env";
import { requireTab } from "@/lib/data/access";
import { getCanvasCatalog } from "@/lib/data/canvas-catalog";
import { effectiveMultiplier } from "@/lib/job-costing";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { JobSections } from "@/components/job/job-sections";
import { ProposalPanel, type InternalZoneBreakdown } from "@/components/canvas/proposal-panel";
import { PRACTICE_ADDRESS, PRACTICE_ZONES as SAMPLE_ZONES } from "@/lib/practice-sample";

/**
 * Making a proposal from a site map, with no job behind it.
 *
 * Laid out the way the proposal is made on a real job: the job's panels, the
 * site map's zones, and the proposal panel open. A sample evaluation has been
 * drawn and submitted, so Generate builds the proposal from its zones the way
 * Submit does on a job, and every button after that works (edit the wording
 * and the price, add a discount, choose how long it stands, approve it) on a
 * copy held in the page. Nothing reaches the database, no client is emailed,
 * and leaving the page clears it.
 */
export const dynamic = "force-dynamic";

/** Crew time, for the sample only, when the business has not set its own rate. */
const SAMPLE_CREW_HOUR_CENTS = 4500;

const STEPS: { title: string; body: string }[] = [
  { title: "Submit the site map", body: "The evaluator submits the evaluation. That builds the proposal: one line per zone, priced from its service, materials and crew time. Here, press Generate now." },
  { title: "Read it through", body: "Open the internal breakdown to see what each zone costs us. The client never sees that part." },
  { title: "Edit if needed", body: "Change the wording of any zone, the price, or add a discount. The total the client sees updates as you type." },
  { title: "Choose how long it stands", body: "7 or 14 days from when it goes out." },
  { title: "Approve it", body: "On a real job, approving puts the email to the client on My Day for you to confirm and send, and the link goes live." },
  { title: "Then the crew sheet", body: "Once the client accepts, the same site map becomes the crew sheet. See the crew sheet practice." },
];

export default async function ProposalPracticePage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  await requireTab("evaluations", "/my-day");
  const catalog = await getCanvasCatalog();
  const hourCents = catalog.crewCostPerHourCents > 0 ? catalog.crewCostPerHourCents : SAMPLE_CREW_HOUR_CENTS;
  const multiplier = effectiveMultiplier(catalog.markup) > 0 ? effectiveMultiplier(catalog.markup) : 2;

  const zones: InternalZoneBreakdown[] = SAMPLE_ZONES.map((z) => {
    const materialsCents = z.materials.reduce((sum, m) => sum + m.cost * 100, 0);
    const labourCents = Math.round(z.crewHours * hourCents);
    const directCostCents = materialsCents + labourCents;
    return {
      zoneName: z.name,
      serviceLabel: z.service,
      notes: z.notes,
      checklistAnswers: [],
      materialLineItems: z.materials,
      crewHours: z.crewHours,
      materialsCents,
      labourCents,
      directCostCents,
      priceCents: Math.round(directCostCents * multiplier),
      hasMissingTiming: false,
      hasUnknownMaterialCost: false,
    };
  });
  const labourCost = zones.reduce((s, z) => s + z.labourCents, 0) / 100;
  const materialsCost = zones.reduce((s, z) => s + z.materialsCents, 0) / 100;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:gap-6 sm:py-10">
      <Link href="/my-day?tab=system" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline">
        <ChevronLeft className="h-3.5 w-3.5" /> The system
      </Link>

      <p className="rounded-lg border border-amber-300/70 bg-amber-50/70 px-3 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-950/30">
        <span className="font-semibold">Practice.</span> A sample evaluation, ready to become a proposal. Nothing here is saved, no client is
        emailed, and leaving the page clears it. Prices are worked out from your own markup
        {catalog.crewCostPerHourCents > 0 ? " and crew rate" : ", with a sample crew rate"}, on sample materials.
      </p>

      <div>
        <h1 className="text-xl font-bold sm:text-2xl">{PRACTICE_ADDRESS}</h1>
        <p className="text-sm text-muted-foreground sm:text-base">Sample client · Evaluation submitted</p>
      </div>

      <details className="rounded-xl border border-border bg-card/60 px-4 py-3">
        <summary className="cursor-pointer list-none text-sm font-semibold [&::-webkit-details-marker]:hidden">
          How a proposal is made <span className="font-normal text-muted-foreground">(tap to open)</span>
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
        defaultOpen="proposal"
        sections={[
          {
            id: "map",
            title: "Site map and measurements",
            hint: `${zones.length} zones drawn`,
            body: (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-muted-foreground">
                  What the evaluator drew and recorded. To try drawing one,{" "}
                  <Link href="/practice/site-map" className="text-primary underline underline-offset-2">
                    open the site map practice
                  </Link>
                  .
                </p>
                <ul className="flex flex-col gap-2">
                  {SAMPLE_ZONES.map((z) => (
                    <li key={z.id} className="rounded-lg border border-border p-2.5">
                      <p className="font-semibold">
                        {z.name} <span className="font-normal text-muted-foreground">· {z.service}</span>
                      </p>
                      <p className="text-muted-foreground">{z.notes}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ),
          },
          {
            id: "proposal",
            title: "Proposal",
            hint: "Practice",
            body: (
              <ProposalPanel
                practice
                jobId="practice"
                proposal={null}
                baseUrl=""
                labourCost={labourCost}
                materialsCost={materialsCost}
                markup={catalog.markup}
                zones={zones}
                discounts={[]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

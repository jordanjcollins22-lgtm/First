import Link from "next/link";
import { redirect } from "next/navigation";

import { isSupabaseConfigured } from "@/lib/env";
import { getCurrentProfile } from "@/lib/data/team";
import { getPricingHealth } from "@/lib/data/pricing-health";
import { isOwnerLevel } from "@/lib/roles";
import { choiceLabel } from "@/lib/tap-estimate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import type { RateCardRow } from "@/lib/pricing-health";

/**
 * Pricing health: can the estimate a client gets off the map be trusted,
 * and what to set so it can.
 *
 * Owner and admin only. It is about the rate card and the money the business
 * charges, and every fix it points at is on a page only they can change.
 * Gated on the roles directly, like Settings, so it needs no permission row
 * of its own.
 */
export const dynamic = "force-dynamic";

/** Where each thing is set. Services are the Services half of Team; materials a tab of Inventory. */
const SERVICES_HREF = "/admin/team";
const MATERIALS_HREF = "/admin/tools?tab=materials";
const PRODUCTION_HREF = "/admin/production-rates";
const OVERHEAD_HREF = "/admin/payments";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n}%`;

const STATE_LABEL: Record<RateCardRow["state"], { text: string; className: string }> = {
  own: { text: "Your timing", className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  flat: { text: "Fixed hours", className: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  typical: { text: "Typical stand-in", className: "bg-red-500/15 text-red-700 dark:text-red-300" },
};

export default async function PricingHealthPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;
  const profile = await getCurrentProfile();
  if (!profile || !(profile.roles.includes("admin") || isOwnerLevel(profile.roles))) redirect("/my-day");

  const health = await getPricingHealth();
  const { rateCard, materials, accuracy, overhead } = health;
  const gaps = rateCard.filter((r) => r.state !== "own");
  const tapGaps = gaps.filter((r) => r.choices.length > 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:py-8">
      <h1 className="mb-1 text-2xl font-bold">Pricing health</h1>
      <p className="mb-6 text-muted-foreground">
        The estimate a client sees after marking their yard is only as good as the rate card under it. Where a number
        is missing, a typical one stands in without saying so. This shows where that is happening, and how the
        estimates have compared with the proposals after the visit.
      </p>

      {health.problems.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {health.problems.map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>
      )}

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Rate card timing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {tapGaps.length === 0
                ? "Every service a client can tap is timed by your own rate card."
                : `${tapGaps.length} of the services a client can tap ${tapGaps.length === 1 ? "is" : "are"} priced on a stand-in. Set the minutes on `}
              {tapGaps.length > 0 && (
                <>
                  <Link href={SERVICES_HREF} className="font-medium text-primary underline-offset-2 hover:underline">
                    Team &amp; Services, Services
                  </Link>
                  .{" "}
                </>
              )}
              Starting figures come from{" "}
              <Link href={PRODUCTION_HREF} className="font-medium text-primary underline-offset-2 hover:underline">
                Production rates
              </Link>
              {health.productionSaved ? "." : ", which are still the app's starting figures, not yours."}
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rateCard.map((row) => (
                <li key={row.typeId} className="px-3 py-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{row.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_LABEL[row.state].className}`}>
                      {STATE_LABEL[row.state].text}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {row.choices.length > 0 ? `Tapped as: ${row.choices.map(choiceLabel).join(", ")}` : "Only from the long pre-evaluation form"}
                    {row.state === "own" && row.minutesPerUnit != null
                      ? ` · ${row.minutesPerUnit} min per ${row.unit}${row.crewSize > 1 ? ` × ${row.crewSize} crew` : ""}`
                      : ""}
                  </p>
                  {row.problem && <p className="mt-1">{row.problem}</p>}
                  {row.fix && (
                    <p className="mt-1">
                      <span className="font-medium">To fix: </span>
                      {row.fix}
                      {row.state !== "own" && row.choices.length > 0 && (
                        <>
                          {" "}
                          <Link href={SERVICES_HREF} className="text-primary underline-offset-2 hover:underline">
                            Open the rate card
                          </Link>
                        </>
                      )}
                    </p>
                  )}
                  {row.state !== "own" && row.suggestion && (
                    <p className="mt-1 text-xs text-muted-foreground">A place to start: {row.suggestion}</p>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Material costs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {materials.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Every material the estimate prices has a rule, a coverage and a cost.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Coverage and cost are set on{" "}
                  <Link href={MATERIALS_HREF} className="font-medium text-primary underline-offset-2 hover:underline">
                    Inventory, Materials
                  </Link>
                  ; which material a service uses is set on{" "}
                  <Link href={SERVICES_HREF} className="font-medium text-primary underline-offset-2 hover:underline">
                    the rate card
                  </Link>
                  .
                </p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {materials.map((row) => (
                    <li key={`${row.typeId}-${row.materialId ?? row.name}`} className="px-3 py-2.5 text-sm">
                      <p className="font-medium">{row.name}</p>
                      <p>{row.say}</p>
                      <p className="mt-1">
                        <span className="font-medium">To fix: </span>
                        {row.fix}{" "}
                        <Link
                          href={row.problem === "no-rule" ? SERVICES_HREF : MATERIALS_HREF}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {row.problem === "no-rule" ? "Open the rate card" : "Open materials"}
                        </Link>
                      </p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Estimate against proposal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {accuracy.jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No job has both an estimate and a sent proposal yet
                {health.awaitingProposal > 0 ? `; ${health.awaitingProposal} estimate${health.awaitingProposal === 1 ? " is" : "s are"} waiting on one` : ""}.
                Each one that goes out is a check on the estimate.
              </p>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Stat
                    label="Typical lean"
                    value={accuracy.medianPct != null ? signed(accuracy.medianPct) : "–"}
                    note="Median of estimate against proposal. Plus means the estimate was higher."
                  />
                  <Stat
                    label={`Within ±${accuracy.tolerancePct}%`}
                    value={`${accuracy.within} of ${accuracy.jobs.length}`}
                    note={`${accuracy.high} high, ${accuracy.low} low beyond that.`}
                  />
                  <Stat
                    label="Before the cushion"
                    value={accuracy.medianSubtotalPct != null ? signed(accuracy.medianSubtotalPct) : "–"}
                    note="The same, without the extra added because nobody had seen the yard: how close the sizes and rates were."
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  The estimate is meant to sit a little above the proposal, because nobody has seen the yard yet. A lean
                  well above that, or below zero, is worth looking into. Proposals are compared before any discount.
                  {health.awaitingProposal > 0 &&
                    ` ${health.awaitingProposal} more estimate${health.awaitingProposal === 1 ? " is" : "s are"} waiting on a sent proposal.`}
                </p>

                {accuracy.byChoice.length > 0 && (
                  <div>
                    <h3 className="mb-1.5 text-sm font-semibold">By what was tapped</h3>
                    <p className="mb-2 text-xs text-muted-foreground">
                      A job counts under each thing tapped on it, so a choice that is often tapped alongside a bad one
                      looks worse than it is. Read it alongside the number of jobs.
                    </p>
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {accuracy.byChoice.map((c) => (
                        <li key={c.choice} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span>{c.label}</span>
                          <span className="text-muted-foreground">
                            {signed(c.medianPct)} median · {c.within} of {c.jobs} within ±{accuracy.tolerancePct}%
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h3 className="mb-1.5 text-sm font-semibold">Jobs, biggest miss first</h3>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {accuracy.jobs.map((job) => (
                      <li key={job.jobId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          <Link href={`/jobs/${job.jobId}`} className="font-medium hover:text-primary">
                            {job.label}
                          </Link>
                          {job.choices.length > 0 && (
                            <span className="block text-xs text-muted-foreground">{job.choices.map(choiceLabel).join(", ")}</span>
                          )}
                        </span>
                        <span className="text-right">
                          {money(job.estimateCents)} estimate · {money(job.proposalCents)} proposal{" "}
                          <span className={job.within ? "text-muted-foreground" : "font-semibold"}>{signed(job.diffPct)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overhead</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {overhead ? (
              <>
                <p className="font-medium">{overhead.headline}</p>
                <p className="text-muted-foreground">{overhead.detail}</p>
                {overhead.example && (
                  <p>
                    A job of {overhead.example.crewHours} crew-hours with {money(overhead.example.materialsCents)} of
                    materials: {money(overhead.example.staffCents)} on a proposal, {money(overhead.example.estimateCents)} on
                    the client&apos;s estimate ({signed(overhead.example.diffPct)}).
                  </p>
                )}
                <p>
                  <Link href={OVERHEAD_HREF} className="text-primary underline-offset-2 hover:underline">
                    Overhead and the per diem are on Payments
                  </Link>
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">The overhead settings couldn&apos;t be read.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/60 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

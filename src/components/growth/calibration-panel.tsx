"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import type { ServiceCalibration, Verdict } from "@/lib/calibration";
import { costOfBeingWrongCents } from "@/lib/calibration";
import { applyMeasuredHours } from "@/lib/actions/calibration-actions";

const TONE: Record<Verdict, string> = {
  under_quoted: "text-destructive",
  over_quoted: "text-amber-700 dark:text-amber-300",
  about_right: "text-emerald-700 dark:text-emerald-300",
  not_enough: "text-muted-foreground",
};

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

/**
 * How long the work takes, against how long it is sold as taking.
 *
 * The services with a case to answer are at the top; the ones with too few
 * finished jobs are at the bottom and say how many more they need rather than
 * showing a number that would look like an answer.
 *
 * Nothing here changes a price on its own. The button is the only path from a
 * measurement to the price list, and it exists so that a price the business
 * charges is always one somebody chose.
 */
export function CalibrationPanel({
  services,
  headline,
  crewCostPerHourCents,
  jobsWithoutTime,
  canApply,
}: {
  services: ServiceCalibration[];
  headline: string;
  crewCostPerHourCents: number | null;
  jobsWithoutTime: number;
  canApply: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();

  function apply(c: ServiceCalibration) {
    if (c.suggestedHours == null) return;
    setError(null);
    start(async () => {
      const result = await applyMeasuredHours({
        serviceTypeId: c.serviceTypeId,
        hours: c.suggestedHours!,
        because: c.says,
      });
      if (!result.ok) setError(result.error);
      else {
        setDone((held) => new Set(held).add(c.serviceTypeId));
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3">
      <p className="text-sm font-medium">{headline}</p>
      {crewCostPerHourCents == null && (
        <p className="text-xs text-muted-foreground">
          No crew cost per hour is set, so what the mis-quoting costs cannot be worked out — only how far off it is.
        </p>
      )}
      {jobsWithoutTime > 0 && (
        <p className="text-xs text-muted-foreground">
          {jobsWithoutTime} finished {jobsWithoutTime === 1 ? "job" : "jobs"} had no clocked time, so said nothing
          here. Clocking on and off is what makes this answerable.
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {services.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing finished with clocked time yet.</p>
      ) : (
        <ul className="space-y-2">
          {services.map((c) => {
            const cost = costOfBeingWrongCents(c, crewCostPerHourCents);
            return (
              <li key={c.serviceTypeId} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{c.serviceTypeId}</span>
                  {cost != null && cost !== 0 && (
                    <span className={`text-sm font-semibold tabular-nums ${TONE[c.verdict]}`}>
                      {cost > 0 ? `${money(cost)} a job` : `${money(-cost)} a job over`}
                    </span>
                  )}
                </div>
                <p className={`mt-0.5 text-xs ${TONE[c.verdict]}`}>{c.says}</p>

                {c.suggestedHours != null &&
                  (done.has(c.serviceTypeId) ? (
                    <p className="mt-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                      Now quoted at {c.suggestedHours} crew-hours.
                    </p>
                  ) : canApply ? (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => apply(c)}
                      className="mt-1.5 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm disabled:opacity-50"
                    >
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Quote it at {c.suggestedHours} hours
                    </button>
                  ) : (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      The owner or an account manager can change what this is quoted at.
                    </p>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

import Link from "next/link";
import { CalendarDays, ClipboardList, MapPin, MessageSquare } from "lucide-react";

import { describeWeather, isRoughDay, weatherEmoji } from "@/lib/weather";
import type { JobBriefing } from "@/lib/data/job-briefing";

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function formatDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/**
 * The morning-of view for each scheduled job: what was drawn, what was quoted,
 * whether anyone has been talking about it, and what the sky is doing at that
 * address on the day the crew is due.
 */
export function JobBriefings({ briefings }: { briefings: JobBriefing[] }) {
  if (briefings.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
        <ClipboardList className="h-4 w-4" />
        Scheduled jobs
      </h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Everything for each booked job, and the forecast at that address for the day.
      </p>

      <div className="flex flex-col gap-3">
        {briefings.map((job) => (
          <article
            key={job.jobId}
            className="rounded-xl border border-white/60 bg-card/60 p-3 backdrop-blur-md"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <Link href={`/jobs/${job.jobId}`} className="font-semibold hover:underline">
                {job.customerName}
              </Link>
              {job.workDate && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5" />
                  {formatDay(job.workDate)}
                  {job.endDate && job.endDate !== job.workDate && ` → ${formatDay(job.endDate)}`}
                </span>
              )}
            </div>

            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              {job.address}
            </p>

            {/* Weather at the address, on the day */}
            {job.forecast ? (
              <div
                className={`mt-2 flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
                  isRoughDay(job.forecast)
                    ? "border-amber-400/70 bg-amber-50/60"
                    : "border-white/60 bg-background/50"
                }`}
              >
                <span className="text-2xl leading-none" aria-hidden>
                  {weatherEmoji(job.forecast.code)}
                </span>
                <div className="min-w-0 text-xs">
                  <p className="font-medium">
                    {describeWeather(job.forecast.code)} · {job.forecast.tempMax}° / {job.forecast.tempMin}°
                  </p>
                  <p className="text-muted-foreground">
                    {job.forecast.precipChance}% rain · {job.forecast.windMax} mph wind
                    {isRoughDay(job.forecast) && " · rough day for outside work"}
                  </p>
                </div>
              </div>
            ) : (
              job.forecastNote && (
                <p className="mt-2 text-xs text-muted-foreground">{job.forecastNote}</p>
              )
            )}

            {/* The project itself */}
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Site map</dt>
                <dd className="text-right">
                  {job.siteMap
                    ? [
                        job.siteMap.imagePath ? "Image" : null,
                        job.siteMap.hasPropertyLine ? "property line" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "Started"
                    : "Not drawn yet"}
                </dd>
              </div>

              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Proposal</dt>
                <dd className="text-right">
                  {job.proposal
                    ? `${job.proposal.status}${
                        job.proposal.total != null ? ` · ${money(job.proposal.total)}` : ""
                      }`
                    : "None yet"}
                </dd>
              </div>

              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Scope</dt>
                <dd className="text-right">
                  {job.proposal?.zoneCount
                    ? `${job.proposal.zoneCount} zone${job.proposal.zoneCount === 1 ? "" : "s"}`
                    : "—"}
                </dd>
              </div>

              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="text-right capitalize">{job.status.replace("_", " ")}</dd>
              </div>
            </dl>

            <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-border pt-2 text-xs">
              <Link href={`/jobs/${job.jobId}`} className="font-medium text-primary hover:underline">
                Open project
              </Link>
              <span className="flex items-center gap-1 text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                {job.messages.client} client · {job.messages.internal} internal
              </span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

import { cache } from "react";
import Link from "next/link";

import { getCurrentOrganizationId } from "@/lib/data/organizations";
import { loadPhotoQuotes, type PhotoQuoteRow } from "@/lib/data/photo-quotes";
import { sayLine } from "@/lib/photo-quote";
import { PanelSection, usd } from "@/components/v2/panels/sales/sales-ui";
import { OpenEntityButton } from "@/components/v2/panels/sales/open-entity-button";
import { PhotoQuoteButtons } from "@/components/v2/panels/sales/photo-quote-controls";

/**
 * Sales › Pipeline › Photo quotes: the small jobs that came in with photos
 * instead of a visit. Each shows who and where, every area with what they
 * want done, its photos and the ideas they ticked, and the rough price from
 * the rate card. Price it on the job's site map and proposal, as any job is,
 * or send them a link to book a visit.
 */

export const loadPhotoQuotesForRequest = cache(async () => loadPhotoQuotes(await getCurrentOrganizationId()));

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) : "";

export async function PhotoQuotesPanel() {
  const data = await loadPhotoQuotesForRequest();
  const { settings } = data;

  return (
    <PanelSection
      title="Photo quotes"
      sub={
        !settings.ready
          ? "Not set up in the database yet. Every booking picks a time until it is."
          : settings.enabled
            ? `Budgets under ${sayLine(settings.line)} skip the visit and send photos instead. Price each one, or ask for a visit.`
            : "Off: every booking picks a time. Turn it on under Automatic."
      }
    >
      {data.waiting.length === 0 ? (
        <p className="rounded-xl border bg-card p-3 text-sm text-muted-foreground">
          Nothing waiting.{data.unsent > 0 ? ` ${data.unsent} started and not sent in yet.` : ""}
        </p>
      ) : (
        <ul className="grid gap-3">
          {data.waiting.map((row) => (
            <PhotoQuoteCard key={row.jobId} row={row} line={settings.line} />
          ))}
        </ul>
      )}
      {data.waiting.length > 0 && data.unsent > 0 && <p className="text-xs text-muted-foreground">{data.unsent} more started and not sent in yet.</p>}

      {data.recent.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm font-semibold">Dealt with this month</p>
          <ul className="grid gap-1.5">
            {data.recent.map((row) => (
              <li key={row.jobId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{row.clientName}</span> · {row.address.split(",")[0]} ·{" "}
                  <span className="text-muted-foreground">
                    {row.visitAt ? `visit booked ${day(row.visitAt)}` : row.outcome === "visit" ? "asked to book a visit" : "priced"}
                  </span>
                </span>
                <OpenEntityButton entity={{ kind: "sales.photo_quote", id: row.jobId }} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </PanelSection>
  );
}

function PhotoQuoteCard({ row, line }: { row: PhotoQuoteRow; line: number }) {
  const over = row.estimateCents != null && row.estimateCents / 100 > line;
  return (
    <li className="grid gap-3 rounded-xl border bg-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{row.clientName}</p>
          <p className="text-sm text-muted-foreground">{row.address}</p>
          <p className="text-xs text-muted-foreground">
            Sent {day(row.submittedAt)}
            {row.budget ? ` · budget ${row.budget}` : ""}
            {row.phone ? ` · ${row.phone}` : ""}
          </p>
        </div>
        {row.estimateCents != null && (
          <div className="text-right">
            <p className="font-mono text-lg">{usd(row.estimateCents / 100)}</p>
            <p className="text-[11px] text-muted-foreground">rough, from the rate card{row.estimateTypical ? " (some typical numbers)" : ""}</p>
          </div>
        )}
      </div>

      {over && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-50">
          Over your {sayLine(line)} line. Worth a visit: the zones and the blueprint get drawn on the site map there.
        </p>
      )}

      <ol className="grid gap-2">
        {row.areas.length === 0 && <li className="text-sm text-muted-foreground">No areas marked.</li>}
        {row.areas.map((area) => (
          <li key={area.id} className="grid gap-1.5 rounded-lg bg-muted/40 p-2.5">
            <p className="text-sm">
              <span className="font-semibold">{area.label}:</span> {area.wants || <span className="text-muted-foreground">nothing written</span>}
            </p>
            {area.services.length > 0 && <p className="text-xs text-muted-foreground">{area.services.join(" · ")}</p>}
            {area.photos.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {area.photos.map((url, i) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" aria-label={`${area.label}, photo ${i + 1}`}>
                    {/* Signed links to a private bucket, so a plain img. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="h-20 w-20 rounded-md object-cover" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{area.noPhotos ? "They couldn't take photos: use the satellite view on the site map." : "No photos."}</p>
            )}
            {area.interested.length > 0 && <p className="text-xs">Interested in: {area.interested.join("; ")}</p>}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-start gap-2">
        <Link
          href={`/jobs/${row.jobId}?open=map`}
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Price it
        </Link>
        <PhotoQuoteButtons jobId={row.jobId} />
        <OpenEntityButton entity={{ kind: "sales.photo_quote", id: row.jobId }} />
      </div>
    </li>
  );
}

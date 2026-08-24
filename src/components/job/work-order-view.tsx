import Link from "next/link";
import { ArrowLeft, MapPin, Navigation, Phone } from "lucide-react";

import { SiteMapImage } from "@/components/proposal/site-map-image";
import { ZonePhotos } from "@/components/job/marked-photo";
import { zonesBounds, type WorkOrder } from "@/lib/work-order";
import type { ProposalSiteImageTransform } from "@/types/domain";

/**
 * The crew's sheet for one job.
 *
 * Deliberately not the job page. That screen is the office's — proposal
 * totals, discounts, invoices — and none of it is a crew member's business to
 * be reading on a customer's driveway. This is the same job seen as work:
 * where each zone is and what to do in it.
 *
 * Server component apart from the photos, which open full screen — a
 * thumbnail is enough to know a photo exists and not enough to see which
 * corner of a bed the evaluator pinned, which is the whole reason the pin was
 * dropped. Nothing here changes any record; the crew do that on Today.
 */
export function WorkOrderView({
  jobId,
  order,
  address,
  customerName,
  jobName,
  siteImagePath,
  imageTransform,
  accountManager,
  back,
}: {
  jobId: string;
  order: WorkOrder;
  address: string;
  customerName: string;
  jobName: string;
  siteImagePath: string | null;
  /** How the satellite photo sits under the zones, from the saved design. */
  imageTransform: ProposalSiteImageTransform | null;
  /** Who to ring when something on site does not match the sheet. */
  accountManager: { name: string; phone: string | null } | null;
  /** Where the back link goes. Defaults to the crew's day, which is where a
   * crew member came from; the office opens this from the job and wants to go
   * back there instead. */
  back?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <Link
        href={back?.href ?? "/today"}
        className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        {back?.label ?? "Back to today"}
      </Link>

      <header>
        <h1 className="text-xl font-bold leading-snug">{address}</h1>
        <p className="text-sm text-muted-foreground">
          {customerName}
          {jobName && ` · ${jobName}`}
        </p>
        <Link
          href={`/jobs/${jobId}/directions`}
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-primary-foreground"
        >
          <Navigation className="h-5 w-5" />
          Directions
        </Link>
      </header>

      {accountManager && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="text-muted-foreground">Questions:</span>
          <span className="font-medium">{accountManager.name}</span>
          {accountManager.phone && (
            <a
              href={`tel:${accountManager.phone}`}
              className="flex min-h-9 items-center gap-1 rounded-lg border border-border px-2 text-sm font-medium"
            >
              <Phone className="h-3.5 w-3.5" />
              Call
            </a>
          )}
        </p>
      )}

      {/* ------------------------------------------------------- the site map */}
      {order.zones.length > 0 && siteImagePath && imageTransform && (
        <SiteMapImage
          imagePath={siteImagePath}
          transform={imageTransform}
          numbered
          dimSurroundings
          frame={zonesBounds(order.zones, imageTransform.canvasWidth, imageTransform.canvasHeight)}
          className="w-full rounded-xl border border-white/60 bg-muted"
          zones={order.zones.map((zone) => ({
            zoneName: zone.name,
            color: zone.color,
            points: zone.points,
          }))}
        />
      )}

      {/* ----------------------------------------------------------- the work */}
      {order.zones.length === 0 ? (
        <p className="rounded-xl border border-amber-400/60 bg-amber-50/60 p-4 text-sm">
          No zones have been marked up on this job yet. Check with the office before you start.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {order.zones.map((zone, i) => (
            <li key={zone.id} className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
              <div className="mb-2 flex items-start gap-2">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                  style={{ backgroundColor: zone.color }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{zone.name}</p>
                  <p className="text-sm text-primary">{zone.service}</p>
                </div>
              </div>

              {(zone.location || zone.sizeLabel) && (
                <p className="mb-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {zone.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {zone.location}
                    </span>
                  )}
                  {zone.sizeLabel && <span>{zone.sizeLabel}</span>}
                </p>
              )}

              {zone.tasks.length > 0 && (
                <dl className="mb-2 flex flex-col gap-1 rounded-lg border border-border bg-background/60 p-2.5 text-sm">
                  {zone.tasks.map((task) => (
                    <div key={task.label} className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">{task.label}</dt>
                      <dd className="text-right font-medium">{task.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {zone.notes && (
                <p className="mb-2 rounded-lg border border-amber-400/50 bg-amber-50/60 p-2.5 text-sm">
                  {zone.notes}
                </p>
              )}

              {/* Below the words, because the words say what to do and the
                  photos say where. Somebody reads the instruction first and
                  then looks for the thing it is talking about. */}
              <ZonePhotos photos={zone.photos} zoneName={zone.name} />

            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

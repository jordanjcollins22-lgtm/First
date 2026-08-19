import Link from "next/link";
import { ArrowLeft, MapPin, Navigation, Wrench } from "lucide-react";

import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/canvas-dimensions";
import { polygonPoints, zonesBounds, type WorkOrder } from "@/lib/work-order";

/**
 * The crew's sheet for one job.
 *
 * Deliberately not the job page. That screen is the office's — proposal
 * totals, discounts, invoices — and none of it is a crew member's business to
 * be reading on a customer's driveway. This is the same job seen as work:
 * where each zone is, what to do in it, and what to bring.
 *
 * Server component with no interactivity, because there is nothing here to
 * change. The crew record progress on Today; this is what to do.
 */
export function WorkOrderView({
  order,
  address,
  customerName,
  jobName,
  siteImageUrl,
  imageTransform,
}: {
  order: WorkOrder;
  address: string;
  customerName: string;
  jobName: string;
  siteImageUrl: string | null;
  /** How the satellite photo sits under the zones, from the saved design. */
  imageTransform: { x: number; y: number; scale: number; rotation: number } | null;
}) {
  const bounds = zonesBounds(order.zones, CANVAS_WIDTH, CANVAS_HEIGHT);
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 px-4 py-4">
      <Link
        href="/today"
        className="flex min-h-9 items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to today
      </Link>

      <header>
        <h1 className="text-xl font-bold leading-snug">{address}</h1>
        <p className="text-sm text-muted-foreground">
          {customerName}
          {jobName && ` · ${jobName}`}
        </p>
        <a
          href={directions}
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-primary-foreground"
        >
          <Navigation className="h-5 w-5" />
          Directions
        </a>
      </header>

      {/* ------------------------------------------------------- the site map */}
      {order.zones.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-white/60 bg-card/60 backdrop-blur-md">
          <svg
            viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
            className="block w-full bg-muted"
            role="img"
            aria-label="Site map with the work zones marked"
          >
            {/* Same placement the canvas uses, so the photo lines up with the
                shapes drawn on top of it. */}
            {siteImageUrl && imageTransform && (
              <g
                transform={`translate(${imageTransform.x} ${imageTransform.y}) rotate(${imageTransform.rotation})`}
              >
                <image
                  href={siteImageUrl}
                  x={-(CANVAS_WIDTH * imageTransform.scale) / 2}
                  y={-(CANVAS_HEIGHT * imageTransform.scale) / 2}
                  width={CANVAS_WIDTH * imageTransform.scale}
                  height={CANVAS_HEIGHT * imageTransform.scale}
                  preserveAspectRatio="xMidYMid slice"
                />
              </g>
            )}

            {order.zones.map((zone, i) => {
              const centre = zone.points.reduce(
                (acc, p) => ({ x: acc.x + p.x / zone.points.length, y: acc.y + p.y / zone.points.length }),
                { x: 0, y: 0 }
              );
              return (
                <g key={zone.id}>
                  <polygon
                    points={polygonPoints(zone.points)}
                    fill={zone.color}
                    fillOpacity={0.35}
                    stroke={zone.color}
                    strokeWidth={3}
                  />
                  {/* Numbered to match the cards below, so "zone 2" means the
                      same thing on the map and in the list. */}
                  <circle cx={centre.x} cy={centre.y} r={16} fill="#ffffff" stroke={zone.color} strokeWidth={3} />
                  <text
                    x={centre.x}
                    y={centre.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={18}
                    fontWeight="bold"
                    fill={zone.color}
                  >
                    {i + 1}
                  </text>
                </g>
              );
            })}
          </svg>
        </section>
      )}

      {/* ------------------------------------------------------ what to bring */}
      {order.toolNames.length > 0 && (
        <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
          <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
            <Wrench className="h-4 w-4" />
            Load the truck
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {order.toolNames.map((tool) => (
              <li
                key={tool}
                className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-xs font-medium"
              >
                {tool}
              </li>
            ))}
          </ul>
        </section>
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

              {zone.materials.length > 0 && (
                <div className="mb-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Materials
                  </p>
                  <ul className="text-sm">
                    {zone.materials.map((material) => (
                      <li key={material.name} className="flex justify-between gap-3">
                        <span>{material.name}</span>
                        <span className="font-medium">{material.quantityLabel}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {zone.toolNames.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">Tools: </span>
                  {zone.toolNames.join(", ")}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

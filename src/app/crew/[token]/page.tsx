import type { Metadata } from "next";

import { FocusableSiteMap } from "@/components/proposal/focusable-site-map";
import { CrewPhoto } from "@/components/crew/crew-photo";
import { LotPicker } from "@/components/intake/lot-picker";
import { canvasImageUrl } from "@/lib/canvas-image-url";
import { crewZoneLabel, jobIdFromCrewToken } from "@/lib/crew-link";
import { loadCrewJob } from "@/lib/data/crew-job";
import { fetchLotFromCounty } from "@/lib/data/lot-map";
import { isSupabaseConfigured } from "@/lib/env";
import { PREVIEW } from "@/lib/storage-image-url";
import { focusFrame } from "@/lib/zone-focus";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Crew map · JS Landscaping",
  // A crew link is for the crew it was texted to, not for search engines.
  robots: { index: false, follow: false },
};

/** "2026-11-28" reads as "Sat, Nov 28". */
function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * The crew's page for one job, opened from a texted link with no login:
 * the address, what's left to do on this visit and any hazard, the scope area by area, the site map and the photos.
 * Nothing about price.
 */
export default async function CrewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const jobId = isSupabaseConfigured ? jobIdFromCrewToken(token) : null;
  const job = jobId ? await loadCrewJob(jobId) : null;

  if (!job) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16 text-center">
        <p className="text-lg font-semibold">This crew link isn&apos;t valid.</p>
        <p className="mt-1 text-sm text-muted-foreground">Ask the office for a new one.</p>
      </div>
    );
  }

  const hasMap = Boolean(job.siteImagePath && job.siteImageTransform);
  const lot =
    !hasMap && job.lat != null && job.lng != null ? await fetchLotFromCounty(job.lat, job.lng, job.address).catch(() => null) : null;
  const drawn = job.zones.filter((z) => z.points.length >= 2);
  const frame =
    hasMap && drawn.length
      ? focusFrame(
          drawn.flatMap((z) => [...z.points, ...(z.shapes ?? []).flat()]),
          job.siteImageTransform!.canvasWidth,
          job.siteImageTransform!.canvasHeight,
          { padding: 60 }
        )
      : undefined;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.address)}`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 pb-16 pt-6">
      <header className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">JS Landscaping · Crew map</p>
        <h1 className="text-2xl font-bold leading-tight">{job.clientName || "Client"}</h1>
        <p className="text-base font-medium">{job.title}</p>
        <p className="text-sm text-muted-foreground">{job.address}</p>
        <a href={directions} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex w-fit rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">
          Directions
        </a>
      </header>

      {job.hazards.length > 0 && (
        <section className="flex flex-col gap-1 rounded-lg border-2 border-amber-500 bg-amber-50 p-4 text-amber-950">
          <h2 className="text-sm font-bold uppercase tracking-wider">Watch out</h2>
          <ul className="list-disc pl-5 text-sm font-medium leading-relaxed">
            {job.hazards.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </section>
      )}

      {job.leftToDo && (
        <section className="flex flex-col gap-1 rounded-lg border-2 border-primary p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Left to do{job.visitDay ? ` · ${dayLabel(job.visitDay)}` : ""}
          </h2>
          <p className="text-base font-medium leading-relaxed">{job.leftToDo}</p>
          <p className="text-xs text-muted-foreground">The full scope is below for reference.</p>
        </section>
      )}

      {hasMap ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Site map</h2>
          <FocusableSiteMap
            imagePath={job.siteImagePath!}
            transform={job.siteImageTransform!}
            zones={job.zones.map((z, i) => ({ zoneName: crewZoneLabel(z.zoneName, i + 1), color: z.color, points: z.points, shapes: z.shapes, number: i + 1 }))}
            defaultFrame={frame}
            numbered
            dimSurroundings
          />
        </section>
      ) : lot ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Site map</h2>
          <LotPicker
            lot={lot}
            picked={job.crewMap?.areas ?? ["whole"]}
            initialTurn={job.crewMap?.turn ?? 0}
            readOnly
            caption={job.crewMap ? "The work area, on the county property line." : "Property line and house from the county map."}
          />
        </section>
      ) : null}

      {job.zones.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Scope of work</h2>
          {job.zones.map((z, i) => (
            <article key={i} className="flex flex-col gap-2 rounded-lg border p-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white" style={{ background: z.color }}>
                  {i + 1}
                </span>
                <h3 className="font-semibold">
                  {crewZoneLabel(z.zoneName, i + 1)}
                  {z.serviceLabel ? <span className="font-normal text-muted-foreground"> · {z.serviceLabel}</span> : null}
                </h3>
              </div>
              <p className="text-sm leading-relaxed">{z.scopeText}</p>
              {z.details.length > 0 && (
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {z.details.map((d, k) => (
                    <li key={k}>{d}</li>
                  ))}
                </ul>
              )}
              {z.photoPaths.length > 0 && (
                <div className="flex snap-x gap-2 overflow-x-auto pb-1">
                  {z.photoPaths.map((p) => (
                    <CrewPhoto key={p} href={canvasImageUrl(p)} src={canvasImageUrl(p, PREVIEW)} alt={`${crewZoneLabel(z.zoneName, i + 1)} photo`}>
                      {(z.photoTaps[p] ?? []).map((t, k) => (
                        <span
                          key={k}
                          aria-label="Tapped spot"
                          className="pointer-events-none absolute h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-red-600 shadow-[0_0_0_2px_white]"
                          style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
                        />
                      ))}
                    </CrewPhoto>
                  ))}
                </div>
              )}
            </article>
          ))}
        </section>
      )}

      {job.notes && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Project notes</h2>
          <p className="whitespace-pre-line rounded-lg border p-4 text-sm leading-relaxed">{job.notes}</p>
        </section>
      )}

      {job.zones.length === 0 && !job.notes && <p className="text-sm text-muted-foreground">No written scope yet. Check with the office.</p>}

      <p className="text-xs text-muted-foreground">Questions on site? Call the office before changing the plan.</p>
    </main>
  );
}

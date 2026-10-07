import { Check, MapPin, Phone } from "lucide-react";

import { ZonePhotos } from "@/components/job/marked-photo";
import {
  OBSERVER_STAGE_BLURBS,
  OBSERVER_STAGE_LABELS,
  OBSERVER_STEPS,
  headline,
  relationshipLabel,
  stageProgress,
  type ObserverProject,
} from "@/lib/observers";

const VISIT_LABELS: Record<string, string> = {
  scheduled: "Booked",
  in_progress: "Under way",
  paused: "Paused",
  done: "Done",
};

function formatDay(value: string): string {
  const date = new Date(value.length > 10 ? value : `${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function visitRange(startsOn: string, endsOn: string): string {
  return startsOn === endsOn ? formatDay(startsOn) : `${formatDay(startsOn)} – ${formatDay(endsOn)}`;
}

/**
 * How the project is going, for somebody who is not the client.
 *
 * A property manager, a management company, a landlord, a spouse. They get the
 * address, where it has got to, when we are coming, what is being done in each
 * area, and the photos.
 *
 * They do not get a price, and there is no button to accept anything. The
 * client already made that decision, and a second approve button is a second
 * place a job can be accepted by the wrong person. Nothing on this page can
 * change any record — it is a window, not a form.
 */
export function ProgressView({ project }: { project: ObserverProject }) {
  const progress = stageProgress(project.stage);
  const currentIndex = OBSERVER_STEPS.indexOf(project.stage);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">
          {project.organizationName}
        </p>
        <h1 className="text-2xl font-bold leading-snug">{project.address}</h1>
        <p className="text-sm text-muted-foreground">
          Project progress for {project.watcherName} · {relationshipLabel(project.relationship)}
        </p>
      </div>

      <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {OBSERVER_STAGE_LABELS[project.stage]}
        </p>
        <p className="mt-1 text-lg font-semibold">{headline(project)}</p>
        {project.stage !== "cancelled" && (
          <p className="mt-1 text-sm text-muted-foreground">{OBSERVER_STAGE_BLURBS[project.stage]}</p>
        )}
      </section>

      {/* A strip rather than a percentage: "60%" of a landscaping job is a
          number nobody can check, but "booked in, work not started" is
          something somebody can look out of a window and agree with. */}
      {progress != null && (
        <ol className="flex gap-1">
          {OBSERVER_STEPS.map((step, i) => {
            const reached = i <= currentIndex;
            return (
              <li key={step} className="flex flex-1 flex-col gap-1">
                <span
                  className={`h-1.5 rounded-full ${reached ? "bg-primary" : "bg-muted"}`}
                  aria-hidden
                />
                <span
                  className={`flex items-center gap-0.5 text-[10px] leading-tight ${
                    reached ? "font-semibold" : "text-muted-foreground"
                  }`}
                >
                  {i < currentIndex && <Check className="h-2.5 w-2.5 shrink-0" />}
                  {OBSERVER_STAGE_LABELS[step]}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {project.visits.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Visits</h2>
          <ul className="flex flex-col gap-1.5">
            {project.visits.map((visit, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-xl border border-border p-3"
              >
                <span className="font-medium">{visitRange(visit.startsOn, visit.endsOn)}</span>
                <span className="text-sm text-muted-foreground">
                  {VISIT_LABELS[visit.status] ?? visit.status}
                  {visit.purpose && ` · ${visit.purpose}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {project.zones.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">What&apos;s being done</h2>
          <div className="flex flex-col gap-3">
            {project.zones.map((zone, i) => (
              <div key={i} className="rounded-2xl border border-border p-4">
                <p className="font-semibold">{zone.name}</p>
                <p className="text-sm text-primary">{zone.service}</p>
                {zone.location && (
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" />
                    {zone.location}
                  </p>
                )}
                {zone.notes && <p className="mt-2 text-sm text-muted-foreground">{zone.notes}</p>}
                {zone.photos.length > 0 && (
                  <div className="mt-2">
                    <ZonePhotos photos={zone.photos} zoneName={zone.name} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {project.contact && (
        <section className="rounded-2xl border border-border p-4 text-center">
          <p className="text-sm text-muted-foreground">Any questions about this project</p>
          <p className="font-semibold">{project.contact.name}</p>
          {project.contact.phone && (
            <a
              href={`tel:${project.contact.phone}`}
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border px-4 text-sm font-medium"
            >
              <Phone className="h-4 w-4" />
              {project.contact.phone}
            </a>
          )}
        </section>
      )}

      {/* Said plainly, because somebody handed this link will otherwise go
          looking for the parts of it they have seen on a proposal. */}
      <p className="text-center text-xs text-muted-foreground">
        This is a progress view, shared with you by {project.organizationName}. Pricing and approvals stay
        between us and {project.customerName || "the owner"}.
      </p>
    </div>
  );
}

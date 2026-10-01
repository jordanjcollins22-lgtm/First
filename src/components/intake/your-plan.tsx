import { LotPicker } from "@/components/intake/lot-picker";
import { isGrounds, PHOTO_AREAS, photoAreasFor, type IntakeAnswers } from "@/lib/evaluation-intake";
import { projectPlan } from "@/lib/intake-plan";
import type { LotData } from "@/lib/lot-map";

/**
 * Their plan back to them before they send it, laid out the way their
 * proposal will be: their property with the parts they picked, each part
 * with the photos they took of it, then what we will do on the whole
 * project, service by service, prep first.
 */
export function YourPlan({ answers, photos, lot }: { answers: IntakeAnswers; photos: { path: string; url: string }[]; lot: LotData | null }) {
  const areas = photoAreasFor(answers.areas, isGrounds(answers));
  const plan = projectPlan(answers);

  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold leading-snug">Your plan so far</h2>
        <p className="text-sm text-muted-foreground">
          What you asked for, laid out the way your proposal will be. We confirm every part of it on the visit.
        </p>
      </div>

      {lot && (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Your property</h3>
          <LotPicker lot={lot} picked={answers.areas} readOnly />
        </div>
      )}

      {areas.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">The areas</h3>
          {areas.map((area) => {
            const place = PHOTO_AREAS.find((a) => a.value === area)!;
            const here = photos.filter((p) => (answers.photo_areas[p.path] ?? "whole") === area);
            return (
              <div key={area} className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
                <p className="font-semibold">{place.label}</p>
                {here.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {here.map((p) => (
                      // Signed links to a private bucket, or local previews in the demo.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={p.path} src={p.url} alt={`Your photo of the ${place.label.toLowerCase()}`} className="aspect-[4/3] w-full rounded-lg object-cover" />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No photos. That&apos;s fine, we&apos;ll take our own on the visit.</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {plan.length > 0 && (
        <div className="flex flex-col gap-4">
          <h3 className="text-base font-semibold">What we&apos;ll do</h3>
          {plan.map((item) => (
            <div key={item.service} className="flex flex-col gap-2">
              <h4 className="font-semibold text-primary">{item.heading}</h4>
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
                {item.sections.map((section) => (
                  <div key={section.heading} className="flex flex-col gap-1">
                    <p className="text-sm font-semibold text-foreground">{section.heading}</p>
                    <ul className="flex flex-col gap-1">
                      {section.items.map((line) => (
                        <li key={line} className="flex gap-2 text-sm text-muted-foreground">
                          <span aria-hidden className="select-none text-primary">
                            •
                          </span>
                          <span className="min-w-0">{line}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

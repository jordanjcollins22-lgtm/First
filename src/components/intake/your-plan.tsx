import { LotPicker } from "@/components/intake/lot-picker";
import { asksLooks, INTAKE_QUESTIONS, PHOTO_AREAS, photoAreasFor, planByService, labelOf, type IntakeAnswers } from "@/lib/evaluation-intake";
import type { LotData } from "@/lib/lot-map";

/**
 * Their plan back to them before they send it, laid out like a proposal:
 * their lot with the parts they picked, then each part with the photos they
 * took of it, then what they want done, service by service.
 */
export function YourPlan({ answers, photos, lot }: { answers: IntakeAnswers; photos: { path: string; url: string }[]; lot: LotData | null }) {
  const areas = photoAreasFor(answers.areas);
  const plan = planByService(answers);
  const looks = INTAKE_QUESTIONS.find((q) => q.key === "looks")!;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold leading-snug">Your plan so far</h2>
      {lot && <LotPicker lot={lot} picked={answers.areas} readOnly />}

      <div className="flex flex-col gap-2">
        {areas.map((area) => {
          const place = PHOTO_AREAS.find((a) => a.value === area)!;
          const here = photos.filter((p) => (answers.photo_areas[p.path] ?? "whole") === area);
          return (
            <div key={area} className="rounded-xl border border-border bg-card p-3">
              <p className="text-sm font-semibold">{place.label}</p>
              {here.length > 0 ? (
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {here.map((p) => (
                    // Signed links to a private bucket, or local previews in the demo.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p.path} src={p.url} alt={`Your photo of the ${place.label.toLowerCase()}`} className="aspect-square w-full rounded-lg object-cover" />
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">No photos. That&apos;s fine, we&apos;ll take our own on the visit.</p>
              )}
            </div>
          );
        })}
      </div>

      {plan.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3">
          <p className="text-sm font-semibold">What you&apos;d like done</p>
          <ul className="mt-2 flex flex-col gap-2">
            {plan.map((item) => (
              <li key={item.service} className="text-sm">
                <p className="font-medium text-primary">{item.label}</p>
                {item.lines.map((line) => (
                  <p key={line.label} className="text-muted-foreground">
                    {line.label}: <span className="text-foreground">{line.value}</span>
                  </p>
                ))}
              </li>
            ))}
          </ul>
          {asksLooks(answers) && answers.looks.length > 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Looks you like: <span className="text-foreground">{answers.looks.map((v) => labelOf(looks, v)).join(", ")}</span>
            </p>
          )}
        </div>
      )}
    </section>
  );
}

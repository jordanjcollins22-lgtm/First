import { Lock } from "lucide-react";

import { STAGE_BLURBS, STAGE_LABELS, STAGE_SHORT_LABELS, type JobStage } from "@/lib/job-stage";

const ORDER: JobStage[] = ["evaluation", "pricing", "scheduled", "working", "done"];

/**
 * Where the job is, and the one thing worth doing next.
 *
 * The strip is there so hiding the locked panels doesn't feel like things went
 * missing — you can see the stage you're in and the ones still ahead.
 */
export function StageHeader({ stage, next }: { stage: JobStage; next: string }) {
  const index = ORDER.indexOf(stage);

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      {stage === "cancelled" ? (
        <p className="text-sm font-semibold text-destructive">Cancelled</p>
      ) : (
        <ol className="mb-2 flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {ORDER.map((s, i) => (
            <li key={s} className="flex shrink-0 items-center gap-1">
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  i === index
                    ? "border-primary bg-primary/10 text-primary"
                    : i < index
                      ? "border-emerald-600/40 bg-emerald-50 text-emerald-800"
                      : "border-border text-muted-foreground"
                }`}
              >
                <span className="sm:hidden">{STAGE_SHORT_LABELS[s]}</span>
                <span className="hidden sm:inline">{STAGE_LABELS[s]}</span>
              </span>
              {i < ORDER.length - 1 && <span className="text-muted-foreground">›</span>}
            </li>
          ))}
        </ol>
      )}

      <p className="text-sm text-muted-foreground">{STAGE_BLURBS[stage]}</p>
      <p className="mt-1 text-sm font-medium">Next: {next}</p>
    </section>
  );
}

/**
 * Stands in for a panel that isn't open yet.
 *
 * Hiding a locked panel outright is what was asked for, but a panel that
 * simply vanishes reads as a bug. One line naming what unlocks it is the
 * difference between a gate and a disappearance.
 */
export function LockedPanel({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3">
      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <p className="text-xs text-muted-foreground">
        <span className="font-semibold">{title}</span> — {reason}
      </p>
    </div>
  );
}

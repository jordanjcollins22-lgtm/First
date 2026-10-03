import Link from "next/link";
import { Check, Circle, Lock, Users } from "lucide-react";

import { PHASE_LABEL } from "@/lib/area-work";
import type { AreaBoardData } from "@/lib/data/area-board";

/**
 * Where the crew are, for the office: each area, who is in it, and what
 * stage it is at. The same board the crew work from, read only.
 */
export function AreaProgress({ jobId, zones, board }: { jobId: string; zones: { id: string; name: string }[]; board: AreaBoardData }) {
  if (zones.length === 0) return null;
  const byId = new Map(board.states.map((s) => [s.zoneId, s]));
  const done = board.states.filter((s) => s.status === "done").length;
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">Areas</h2>
        <Link href={`/jobs/${jobId}/work-order`} className="text-xs text-primary hover:underline">
          {done} of {zones.length} done · open the crew sheet
        </Link>
      </div>
      <ul className="flex flex-col gap-1.5">
        {zones.map((zone) => {
          const s = byId.get(zone.id);
          if (!s) return null;
          return (
            <li key={zone.id} className="flex items-start gap-2 text-sm">
              {s.status === "done" ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : s.status === "working" ? (
                <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              ) : s.status === "waiting" ? (
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" />
              )}
              <span className={`flex-1 ${s.status === "done" ? "text-muted-foreground" : "font-medium"}`}>{zone.name}</span>
              <span className="shrink-0 text-right text-xs text-muted-foreground">
                {s.status === "done"
                  ? "Done"
                  : s.status === "working"
                    ? `${s.people.map((p) => p.name).join(", ")} · ${s.phase === "done" ? "photo" : PHASE_LABEL[s.phase]} ${s.stepsDone}/${s.stepsTotal}`
                    : s.stepsDone > 0
                      ? `Paused · ${s.stepsDone}/${s.stepsTotal}`
                      : "Not started"}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

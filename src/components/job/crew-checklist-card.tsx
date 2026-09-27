import { CheckCircle2, Circle } from "lucide-react";

import type { CrewChecklist } from "@/lib/crew-checklist";

/**
 * The top of the crew sheet: what goes on the truck, then the areas, each
 * ticked once its after photo is in. Read before leaving the shop, glanced
 * at on site.
 */
export function CrewChecklistCard({ checklist }: { checklist: CrewChecklist }) {
  const done = checklist.areas.filter((a) => a.done).length;
  if (checklist.areas.length === 0 && checklist.tools.length === 0 && checklist.materials.length === 0) return null;
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <h2 className="text-sm font-bold uppercase tracking-wide text-primary">Checklist</h2>

      {(checklist.tools.length > 0 || checklist.materials.length > 0) && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Load the truck</p>
          <ul className="flex flex-col gap-1 text-sm">
            {checklist.tools.map((tool) => (
              <li key={`tool:${tool}`} className="flex items-center gap-2">
                <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                {tool}
              </li>
            ))}
            {checklist.materials.map((material) => (
              <li key={`material:${material.name}`} className="flex items-center gap-2">
                <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{material.name}</span>
                <span className="text-xs text-muted-foreground">{material.amount}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {checklist.areas.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            The work · {done} of {checklist.areas.length} done
          </p>
          <ul className="flex flex-col gap-1 text-sm">
            {checklist.areas.map((area) => (
              <li key={area.id} className="flex items-center gap-2">
                {area.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className={area.done ? "text-muted-foreground line-through" : "font-medium"}>{area.name}</span>
                <span className="text-xs text-muted-foreground">{area.service}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">An area ticks itself off when its after photo is in.</p>
        </div>
      )}
    </section>
  );
}

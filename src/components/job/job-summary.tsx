import { Check, Circle, Clock } from "lucide-react";

import { dueNextLabel, progress, type OutstandingItem } from "@/lib/job-outstanding";

/**
 * The whole job in the space above the fold.
 *
 * One line for what is due next, then the ticks. Somebody opening a job on a
 * phone is nearly always answering a question with a one-word answer: have
 * the after photos gone in. This answers it without a single tap.
 */
export function JobSummary({ items }: { items: OutstandingItem[] }) {
  const { done, total } = progress(items);
  const next = dueNextLabel(items);

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Due next</p>
      <p className="mt-0.5 text-lg font-semibold leading-snug">{next}</p>

      {total > 0 && (
        <>
          <p className="mt-3 text-xs text-muted-foreground">
            {done} of {total} submitted
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2">
                {item.done ? (
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                ) : item.waiting ? (
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                ) : (
                  <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                )}
                <span
                  className={`text-xs ${
                    item.done ? "text-muted-foreground line-through" : "font-medium"
                  }`}
                >
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

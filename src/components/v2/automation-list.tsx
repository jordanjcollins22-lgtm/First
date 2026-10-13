"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { Automation } from "@/lib/automations";

/**
 * Every automated message, with how many people are in it right now. Tap one
 * to see who they are, why they're in it, and what they get next.
 */
export function AutomationList({ automations }: { automations: Automation[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="grid gap-3">
      {automations.map((a) => {
        const isOpen = open === a.id;
        return (
          <section key={a.id} className="rounded-xl border bg-card">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : a.id)}
              className="flex w-full items-center gap-4 p-4 text-left hover:bg-muted/50"
            >
              {isOpen ? <ChevronDown className="h-5 w-5 shrink-0" /> : <ChevronRight className="h-5 w-5 shrink-0" />}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{a.name}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    To {a.to.toLowerCase()} · {a.channel.toLowerCase()}
                  </span>
                  {!a.on && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-900 dark:bg-orange-900/40 dark:text-orange-100">Off</span>}
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{a.how}</span>
              </span>
              <span className="text-right">
                <span className="block font-mono text-2xl">{a.people.length}</span>
                <span className="text-xs text-muted-foreground">{a.people.length === 1 ? "person in it" : "people in it"}</span>
              </span>
            </button>
            {isOpen && (
              <div className="border-t px-4 pb-4 pt-3">
                {a.offNote && <p className="mb-3 text-sm font-medium text-orange-800 dark:text-orange-200">{a.offNote}</p>}
                {a.people.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nobody is in this right now.</p>
                ) : (
                  <ul className="grid gap-1.5">
                    {a.people.map((p, i) => (
                      <li key={i} className="grid gap-0.5 rounded-lg bg-muted px-3 py-2 text-sm sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,16rem)] sm:gap-3">
                        <span className="font-semibold">{p.name}</span>
                        <span className="text-muted-foreground">{p.why}</span>
                        <span>{p.next}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

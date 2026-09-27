"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, Plus } from "lucide-react";

import { cn } from "@/lib/utils";

export interface JourneyStep {
  key: string;
  title: string;
  what: string;
  screen: ReactNode;
  /** Only when something was not done beforehand: the key of what was missed. */
  missed?: string;
}

/**
 * The evaluator's pages as they go when everything was done beforehand,
 * with a chip at the top for each thing that might not have been. Picking
 * one adds the pages it brings in, marked with what brought them.
 */
export function JourneyPages({ steps, missed }: { steps: JourneyStep[]; missed: { key: string; label: string }[] }) {
  const [on, setOn] = useState<string[]>([]);
  const shown = steps.filter((s) => !s.missed || on.includes(s.missed));
  const toggle = (key: string) => setOn((list) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]));
  const labelOf = (key: string) => missed.find((m) => m.key === key)?.label ?? key;

  return (
    <>
      {missed.length > 0 && (
      <section className="sticky top-14 z-10 rounded-xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">Add the pages for something not done beforehand</p>
          <p className="text-xs text-muted-foreground">
            {shown.length} pages{on.length ? "" : ", everything done"}
            {on.length > 0 && (
              <button type="button" className="ml-2 font-medium text-primary" onClick={() => setOn([])}>
                Back to the main pages
              </button>
            )}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {missed.map((m) => {
            const active = on.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(m.key)}
                className={cn(
                  "flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                  active ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-background hover:bg-accent/50"
                )}
              >
                {active ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {m.label}
              </button>
            );
          })}
        </div>
      </section>
      )}

      {/* The same frames as the pre-evaluation form's pages: one phone
          screen each, all one size, scrolled inside. */}
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((step, i) => (
          <li key={step.key} className="flex flex-col gap-1.5">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Page {i + 1} of {shown.length}
              {step.missed ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 normal-case tracking-normal text-primary">Added: {labelOf(step.missed)}</span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 normal-case tracking-normal">{step.title}</span>
              )}
            </p>
            <p className="min-h-8 text-xs leading-snug text-muted-foreground">
              {step.missed && <span className="font-semibold text-foreground">{step.title}. </span>}
              {step.what}
            </p>
            <div
              className={cn(
                "relative flex h-[640px] flex-col overflow-y-auto rounded-2xl border bg-background px-4 pt-4 pb-4 shadow-sm",
                step.missed ? "border-primary/50" : "border-border"
              )}
            >
              {step.screen}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

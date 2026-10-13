"use client";

import { useCallback, useEffect, useState } from "react";
import { HelpCircle } from "lucide-react";

import { markTourDone } from "@/lib/actions/tutorial-actions";
import type { Tour } from "@/lib/tutorials/types";

/**
 * Walks a person through their role the first time they open the app, one
 * short card at a time, pointing at the real thing on screen. The Help
 * button brings it back any time. Pointing works by a data-tour attribute
 * on the element: it gets a ring and is scrolled into view.
 */
export function TutorialRunner({ tours, autoStart }: { tours: Tour[]; autoStart: boolean }) {
  const steps = tours.flatMap((t) => t.steps.map((s) => ({ ...s, tour: t })));
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);

  useEffect(() => {
    // Once the page has drawn, so the things it points at exist.
    if (autoStart && steps.length) {
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    }
  }, [autoStart, steps.length]);

  const step = open ? steps[i] : undefined;
  useEffect(() => {
    if (!step?.target) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-4", "ring-primary", "ring-offset-2", "rounded-lg", "relative", "z-[61]");
    return () => el.classList.remove("ring-4", "ring-primary", "ring-offset-2", "z-[61]");
  }, [step]);

  const finish = useCallback(() => {
    setOpen(false);
    setI(0);
    for (const t of tours) void markTourDone(t.id);
  }, [tours]);

  if (!steps.length) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setI(0);
          setOpen(true);
        }}
        data-tour="help"
        className="fixed bottom-4 right-4 z-40 flex min-h-12 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-semibold shadow-lg hover:bg-muted"
      >
        <HelpCircle className="h-5 w-5" /> Help
      </button>
      {step && (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center p-3 sm:bottom-6" role="dialog" aria-modal="false" aria-label={step.title}>
          <div className="w-full max-w-md rounded-2xl border bg-card p-4 shadow-2xl">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {step.tour.title} · {i + 1} of {steps.length}
            </p>
            <h2 className="mt-1 text-lg font-extrabold">{step.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            <div className="mt-4 flex items-center gap-2">
              <button type="button" onClick={finish} className="min-h-11 px-2 text-sm text-muted-foreground hover:text-foreground">
                Skip
              </button>
              <div className="flex-1" />
              {i > 0 && (
                <button type="button" onClick={() => setI(i - 1)} className="min-h-11 rounded-lg border px-4 text-sm font-semibold hover:bg-muted">
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={() => (i + 1 < steps.length ? setI(i + 1) : finish())}
                className="min-h-11 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
              >
                {i + 1 < steps.length ? "Next" : "Got it"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

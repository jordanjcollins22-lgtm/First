"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Copy, X } from "lucide-react";

import type { TutorialStep } from "@/lib/affiliate-tutorial";

type Box = { top: number; left: number; width: number; height: number };

const PAD = 8;
const GAP = 14;
const MARGIN = 16;

/**
 * A tutorial the way a game does one: the screen dims, the part that matters
 * is lit up, and a card says what it is, one step at a time with Next and
 * Back. Opens by itself the first time (autoStart), and from the ? button
 * in the corner any time after. Finishing or skipping calls
 * onDone, which is where it is remembered.
 */
export function GameTutorial({ steps, autoStart, onDone }: { steps: TutorialStep[]; autoStart: boolean; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [card, setCard] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[index];

  useEffect(() => {
    if (!autoStart) return;
    const timer = setTimeout(() => setOpen(true), 600);
    return () => clearTimeout(timer);
  }, [autoStart]);

  // Find what this step is about, bring it into view, and measure it.
  const measure = useCallback(() => {
    const el = step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    const rect = el?.getBoundingClientRect();
    const target = rect && rect.width > 0 && rect.height > 0 ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 } : null;
    setBox(target);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cw = cardRef.current?.offsetWidth ?? Math.min(360, vw - MARGIN * 2);
    const ch = cardRef.current?.offsetHeight ?? 220;
    if (!target) {
      setCard({ top: Math.max(MARGIN, (vh - ch) / 2), left: (vw - cw) / 2 });
      return;
    }
    const below = target.top + target.height + GAP;
    const above = target.top - GAP - ch;
    const top = below + ch <= vh - MARGIN ? below : above >= MARGIN ? above : Math.max(MARGIN, vh - ch - MARGIN);
    const left = Math.min(Math.max(MARGIN, target.left + target.width / 2 - cw / 2), vw - cw - MARGIN);
    setCard({ top, left });
  }, [step]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = step?.target ? document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`) : null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Straight away, then again once the scroll has settled and the card
    // knows its own size.
    const timers = [setTimeout(measure, 0), setTimeout(measure, 120), setTimeout(measure, 450)];
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, step, measure]);

  const close = useCallback(() => {
    setOpen(false);
    setIndex(0);
    onDone();
  }, [onDone]);

  const next = useCallback(() => (index === steps.length - 1 ? close() : setIndex((i) => i + 1)), [index, steps.length, close]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, next, back]);

  const last = index === steps.length - 1;

  return (
    <>
      {/* Always there, in the corner, to go through it again. */}
      {!open && (
        <button
          type="button"
          onClick={() => {
            setIndex(0);
            setOpen(true);
          }}
          className="fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#2f6d3c] text-xl font-black text-white shadow-lg shadow-black/25 ring-2 ring-white hover:bg-[#25572f]"
          aria-label="How it works: open the tutorial"
          title="How it works"
        >
          ?
        </button>
      )}

      {open && step && (
        <div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label={step.title}>
          {/* The dim, with a hole where the step's part is. */}
          {box ? (
            <div
              className="pointer-events-none absolute rounded-2xl outline outline-4 outline-[#7bd389] transition-all duration-300 ease-out"
              style={{ top: box.top, left: box.left, width: box.width, height: box.height, boxShadow: "0 0 0 9999px rgba(8, 20, 12, 0.72)" }}
            >
              {/* The button as it will be once the one before is tapped. */}
              {step.becomes && (
                <span
                  className="absolute flex items-center justify-center gap-1 rounded-md bg-primary text-sm font-medium text-primary-foreground"
                  style={{ inset: PAD }}
                >
                  <Copy className="h-4 w-4" /> {step.becomes}
                </span>
              )}
            </div>
          ) : (
            <div className="absolute inset-0 bg-[rgba(8,20,12,0.72)]" />
          )}

          <div
            ref={cardRef}
            key={step.key}
            className="absolute w-[min(360px,calc(100vw-32px))] animate-in fade-in zoom-in-95 rounded-2xl border-2 border-[#9ccaa5] bg-[#eef6ef] p-4 text-neutral-900 shadow-2xl duration-300"
            style={card ?? { top: "50%", left: "50%", transform: "translate(-50%, -50%)" }}
          >
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2f6d3c]">
                <Image src="/logo-mark.png" alt="" width={24} height={24} className="h-6 w-6" priority />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#2f6d3c]">
                  Step {index + 1} of {steps.length}
                </p>
                <div className="mt-1 flex gap-1">
                  {steps.map((s, i) => (
                    <span key={s.key} className={`h-1.5 flex-1 rounded-full ${i <= index ? "bg-[#2f6d3c]" : "bg-[#cfe3d2]"}`} />
                  ))}
                </div>
              </div>
              <button type="button" onClick={close} aria-label="Skip the tutorial" className="rounded-full p-1 text-neutral-500 hover:bg-[#dcebdf] hover:text-neutral-800">
                <X className="h-4 w-4" />
              </button>
            </div>

            <h2 className="mt-3 text-lg font-extrabold leading-snug">{step.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-neutral-700">{step.body}</p>

            <div className="mt-4 flex items-center justify-between gap-2">
              {index > 0 ? (
                <button type="button" onClick={back} className="flex h-10 items-center gap-0.5 rounded-lg px-2 text-sm font-semibold text-neutral-600 hover:bg-[#dcebdf]">
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
              ) : (
                <button type="button" onClick={close} className="h-10 rounded-lg px-2 text-sm font-medium text-neutral-500 hover:bg-[#dcebdf]">
                  Skip
                </button>
              )}
              <button
                type="button"
                onClick={next}
                className="flex h-10 items-center gap-1 rounded-lg bg-[#2f6d3c] px-4 text-sm font-bold text-white hover:bg-[#25572f]"
              >
                {last ? "Let's go" : index === 0 ? "Show me" : "Next"} {!last && <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

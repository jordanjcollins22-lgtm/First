"use client";

import { useState } from "react";
import { CheckCircle2, Plus } from "lucide-react";

import { IntakeForm, stepsFor } from "@/components/intake/intake-form";
import { DemoAddressBox, type DemoAddress } from "@/components/intake/demo-address";
import { cleanAnswers, DETAIL_QUESTIONS, INTAKE_QUESTIONS } from "@/lib/evaluation-intake";
import type { LotData } from "@/lib/lot-map";
import { cn } from "@/lib/utils";

/** The services that bring in pages of their own, in the order the form lists them. */
const ADDITIONS = (INTAKE_QUESTIONS.find((q) => q.key === "services")?.options ?? []).filter((option) =>
  DETAIL_QUESTIONS.some((q) => q.services?.includes(option.value))
);

/**
 * The choices inside a service that open one more page (mulch colour, river
 * rock size, sod or seed, how many storeys), so picking a service shows all
 * of its pages.
 */
const FOLLOW_UPS = { beds_add: ["mulch", "stone"], lawn_need: ["patch"], wash_what: ["siding"] };

/**
 * The form's pages side by side. The core pages everybody gets are always
 * shown; the pages a service adds appear when that service is picked at the
 * top, each marked with what added it.
 */
export function AllPages({ lot: shopLot }: { lot: LotData | null }) {
  const [picked, setPicked] = useState<string[]>([]);
  const [someoneElse, setSomeoneElse] = useState(false);
  const [demo, setDemo] = useState<DemoAddress | null>(null);
  const lot = demo ? demo.lot : shopLot;

  // Front yard picked so the lot shows what picking does.
  const answers = cleanAnswers({ services: picked, areas: ["front"], details: FOLLOW_UPS, decision: someoneElse ? "others" : "" });
  const steps = stepsFor(answers);
  const signature = `${picked.join(",")}|${someoneElse}|${demo?.address ?? "shop"}`;
  const toggle = (value: string) => setPicked((list) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]));

  const chip = (on: boolean) =>
    cn(
      "flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
      on ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-background hover:bg-accent/50"
    );

  return (
    <>
      <div className="max-w-lg">
        <DemoAddressBox value={demo} onChange={setDemo} />
      </div>

      <section className="sticky top-14 z-10 rounded-xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">Add the pages a selection brings in</p>
          <p className="text-xs text-muted-foreground">
            {steps.length} pages{picked.length || someoneElse ? "" : ", core only"}
            {(picked.length > 0 || someoneElse) && (
              <button
                type="button"
                className="ml-2 font-medium text-primary"
                onClick={() => {
                  setPicked([]);
                  setSomeoneElse(false);
                }}
              >
                Back to core only
              </button>
            )}
          </p>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ADDITIONS.map((option) => {
            const on = picked.includes(option.value);
            return (
              <button key={option.value} type="button" aria-pressed={on} className={chip(on)} onClick={() => toggle(option.value)}>
                {on ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {option.label}
              </button>
            );
          })}
          <button type="button" aria-pressed={someoneElse} className={chip(someoneElse)} onClick={() => setSomeoneElse((v) => !v)}>
            {someoneElse ? <CheckCircle2 className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            Somebody else decides, or an HOA
          </button>
        </div>
      </section>

      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {steps.map((step, i) => {
          const addedBy = step.kind === "detail" ? step.question.group : step.kind === "people" ? "Somebody else decides, or an HOA" : null;
          return (
            <li key={step.key} className="flex flex-col gap-1.5">
              <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Page {i + 1} of {steps.length}
                {addedBy ? (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 normal-case tracking-normal text-primary">Added by {addedBy}</span>
                ) : (
                  <span className="rounded-full bg-muted px-2 py-0.5 normal-case tracking-normal">Everyone</span>
                )}
              </p>
              <div
                className={cn(
                  "relative flex h-[640px] flex-col overflow-y-auto rounded-2xl border bg-background px-4 pt-4 shadow-sm",
                  addedBy ? "border-primary/50" : "border-border"
                )}
              >
                <IntakeForm
                  key={`${step.key}:${signature}`}
                  token={"0".repeat(24)}
                  initial={answers}
                  initialPhotos={[]}
                  submittedAt={null}
                  together={false}
                  businessPhone={null}
                  greeting="Sarah, a few quick questions, one at a time, so we arrive with ideas instead of guesses. Nothing here is binding."
                  demo
                  lot={lot}
                  startAt={step.key}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

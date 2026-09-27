"use client";

import { useState } from "react";

import { IntakeForm, stepsFor } from "@/components/intake/intake-form";
import { DemoAddressBox, type DemoAddress } from "@/components/intake/demo-address";
import { cleanAnswers } from "@/lib/evaluation-intake";
import type { LotData } from "@/lib/lot-map";

/**
 * Answers that bring in every page: every service, the choices that open a
 * follow-up (mulch and stone, a lawn repair, siding), and somebody else in
 * the decision. Front yard is picked so the lot shows what picking does.
 */
const EVERY_PAGE = cleanAnswers({
  services: ["beds", "lawn", "cleanup", "removal", "drainage", "hardscape", "washing", "holiday", "other"],
  areas: ["front"],
  details: { beds_add: ["mulch", "stone"], lawn_need: ["patch"], wash_what: ["siding"] },
  decision: "others",
});

export function AllPages({ lot: shopLot }: { lot: LotData | null }) {
  const steps = stepsFor(EVERY_PAGE);
  const [demo, setDemo] = useState<DemoAddress | null>(null);
  const lot = demo ? demo.lot : shopLot;
  return (
    <>
    <div className="max-w-lg">
      <DemoAddressBox value={demo} onChange={setDemo} />
    </div>
    <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {steps.map((step, i) => (
        <li key={step.key} className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Page {i + 1} of {steps.length}
            {step.kind === "detail" && ` · only if they pick ${step.question.group}`}
            {step.kind === "people" && " · only if somebody else decides too"}
          </p>
          <div className="relative flex h-[640px] flex-col overflow-y-auto rounded-2xl border border-border bg-background px-4 pt-4 shadow-sm">
            <IntakeForm
              token={"0".repeat(24)}
              initial={EVERY_PAGE}
              initialPhotos={[]}
              submittedAt={null}
              together={false}
              businessPhone={null}
              greeting="Sarah, a few quick questions, one at a time, so we arrive with ideas instead of guesses. Nothing here is binding."
              demo
              key={`${step.key}:${demo?.address ?? "shop"}`}
              lot={lot}
              startAt={step.key}
            />
          </div>
        </li>
      ))}
    </ol>
    </>
  );
}

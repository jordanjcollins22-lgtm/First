"use client";

import { useState } from "react";

import { IntakeForm } from "@/components/intake/intake-form";
import { DemoAddressBox, type DemoAddress } from "@/components/intake/demo-address";
import { emptyAnswers } from "@/lib/evaluation-intake";

export function DemoForm() {
  const [demo, setDemo] = useState<DemoAddress | null>(null);
  return (
    <>
      <DemoAddressBox value={demo} onChange={setDemo} />
      <header className="mb-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">JS Landscaping MD</p>
        <h1 className="text-lg font-semibold">Before we come out</h1>
        <p className="truncate text-xs text-muted-foreground">{demo?.address ?? "123 Example Lane"} · Tuesday at 10:00 am</p>
      </header>
      {/* Started again for a new address, so the map is on the page it belongs to. */}
      <IntakeForm
        key={demo?.address ?? "none"}
        token={"0".repeat(24)}
        initial={emptyAnswers()}
        initialPhotos={[]}
        submittedAt={null}
        together={false}
        businessPhone={null}
        greeting="Sarah, a few quick questions, one at a time, so we arrive with ideas instead of guesses. Nothing here is binding."
        demo
        lot={demo?.lot ?? null}
      />
    </>
  );
}

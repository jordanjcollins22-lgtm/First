"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { RecordAndSend } from "@/components/hiring/record-and-send";

/** The skills question, answered by tapping Record and saying it, live in the page. Nothing written or uploaded. */
export function SkillsStep({ token, question, alreadyIn, businessName }: { token: string; question: string; alreadyIn: boolean; businessName: string }) {
  const [done, setDone] = useState(alreadyIn);

  if (done) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-2 text-lg font-semibold">We have your answer</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Someone from {businessName} will watch it and be in touch. Want to change it? Record a new one and it replaces this one.
        </p>
        <Button type="button" variant="outline" className="mt-3" onClick={() => setDone(false)}>
          Record a new answer
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <p className="text-base font-semibold">{question}</p>
      <p className="text-sm text-muted-foreground">Say it the way you really would. Under a minute is plenty.</p>
      <RecordAndSend token={token} purpose="skills" label="Tap to record" onSent={() => setDone(true)} />
    </section>
  );
}

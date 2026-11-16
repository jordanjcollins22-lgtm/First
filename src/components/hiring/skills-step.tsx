"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitSkillsAnswer } from "@/lib/actions/hiring-public-actions";

/**
 * The skills question, answered from their phone: in writing, or a link to a
 * recording (a voice memo or video shared from their phone), or both.
 */
export function SkillsStep({ token, question, alreadyIn, businessName }: { token: string; question: string; alreadyIn: boolean; businessName: string }) {
  const [done, setDone] = useState(alreadyIn);
  const [answer, setAnswer] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function send() {
    setError(null);
    start(async () => {
      const result = await submitSkillsAnswer({ token, answer, link });
      if (!result.ok) return setError(result.error);
      setDone(true);
    });
  }

  if (done) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-2 text-lg font-semibold">We have your answer</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Someone from {businessName} will read it and be in touch. Want to change it? Send a new one and it replaces this one.
        </p>
        <Button type="button" variant="outline" className="mt-3" onClick={() => setDone(false)}>
          Send a new answer
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <p className="text-base font-semibold">{question}</p>
      <p className="text-sm text-muted-foreground">Answer the way you really would. A few sentences is plenty.</p>
      <Textarea rows={6} placeholder="What you'd say" value={answer} onChange={(e) => setAnswer(e.target.value)} aria-label="Your answer" />
      <label className="grid gap-1 text-sm">
        <span className="text-muted-foreground">Rather say it out loud? Record it on your phone, share it, and paste the link here (optional).</span>
        <Input type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" className="w-full" disabled={busy} onClick={send}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Send my answer
      </Button>
    </section>
  );
}

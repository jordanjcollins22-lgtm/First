"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { describeSequence, PLACEHOLDERS, renderTemplate, SAMPLE_VARS, type SequenceStep } from "@/lib/evaluation-sequence";
import { resetEvaluationSequenceStep, saveEvaluationSequenceStep } from "@/lib/actions/evaluation-sequence-actions";
import type { EvaluationSequenceView } from "@/lib/data/evaluation-sequence";

/**
 * The five emails around a booked evaluation, in the order they go.
 *
 * Each one opens to its wording and a preview filled in for a sample
 * client, so what a change will look like is on screen before Save. The
 * counts at the top are the evidence that it is running.
 */
export function EvaluationSequencePanel({ view }: { view: EvaluationSequenceView }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">Evaluation emails</h2>
        <p className="text-sm text-muted-foreground">{describeSequence(view.steps)}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        Sent from the business mailbox to everyone who books an evaluation, in this order. Each person gets each
        email once. Nothing goes out before 8am or after 9pm on the business clock, and nobody who has
        unsubscribed or is marked do not contact is written to.
      </p>
      <p className="text-xs text-muted-foreground">
        Last 30 days: {view.recent.sent} sent{view.recent.failed > 0 ? `, ${view.recent.failed} failed` : ""}
        {view.recent.lastSentAt ? `, most recent ${new Date(view.recent.lastSentAt).toLocaleDateString()}` : ""}.
      </p>

      <ol className="flex flex-col gap-2">
        {view.steps.map((step) => (
          <StepCard key={step.step} step={step} />
        ))}
      </ol>

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer font-medium">What the braces fill in</summary>
        <ul className="mt-1 grid gap-0.5 sm:grid-cols-2">
          {PLACEHOLDERS.map((p) => (
            <li key={p.key}>
              <code className="rounded bg-muted px-1">{`{${p.key}}`}</code> {p.means}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function StepCard({ step }: { step: SequenceStep }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(true);
  const [enabled, setEnabled] = useState(step.enabled);
  const [subject, setSubject] = useState(step.subject);
  const [body, setBody] = useState(step.body);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const dirty = subject !== step.subject || body !== step.body || enabled !== step.enabled;

  function save(next: { enabled?: boolean } = {}) {
    setError(null);
    setSaved(false);
    start(async () => {
      const result = await saveEvaluationSequenceStep({
        step: step.step,
        enabled: next.enabled ?? enabled,
        subject,
        body,
      });
      if (!result.ok) return setError(result.error);
      setSaved(true);
      router.refresh();
    });
  }

  function reset() {
    setError(null);
    start(async () => {
      const result = await resetEvaluationSequenceStep(step.step);
      if (!result.ok) return setError(result.error);
      router.refresh();
    });
  }

  return (
    <li className={cn("rounded-lg border border-border bg-background/60", open && "border-primary/50")}>
      <div className="flex items-start gap-3 px-3 py-2.5">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
          {step.ordinal}
        </span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-semibold">{step.label}</span>
            <span className="text-xs text-muted-foreground">{step.timing}</span>
            {step.custom && <span className="text-[11px] text-muted-foreground">edited</span>}
          </div>
          <p className="truncate text-sm text-muted-foreground">{renderTemplate(step.subject, SAMPLE_VARS)}</p>
        </button>
        <label className="flex shrink-0 items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(e) => {
              setEnabled(e.target.checked);
              save({ enabled: e.target.checked });
            }}
            className="h-4 w-4"
          />
          On
        </label>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-label={open ? "Close" : "Open"}>
          {open ? <ChevronUp className="mt-1 h-4 w-4 text-muted-foreground" /> : <ChevronDown className="mt-1 h-4 w-4 text-muted-foreground" />}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
          <div className="flex gap-1 text-xs">
            <button
              type="button"
              onClick={() => setPreview(true)}
              className={cn("rounded-full border px-3 py-1", preview ? "border-primary bg-primary/10 font-medium text-primary" : "border-border")}
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setPreview(false)}
              className={cn("rounded-full border px-3 py-1", !preview ? "border-primary bg-primary/10 font-medium text-primary" : "border-border")}
            >
              Edit wording
            </button>
          </div>

          {preview ? (
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <p className="font-medium">{renderTemplate(subject, SAMPLE_VARS)}</p>
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{renderTemplate(body, SAMPLE_VARS)}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">Filled in for a sample client. Real emails use the real booking.</p>
            </div>
          ) : (
            <>
              <label htmlFor={`subject-${step.step}`} className="flex flex-col gap-1">
                <span className="text-xs font-medium">Subject</span>
                <input
                  id={`subject-${step.step}`}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={pending}
                  className="h-10 rounded-md border border-border bg-background px-3 text-sm"
                />
              </label>
              <label htmlFor={`body-${step.step}`} className="flex flex-col gap-1">
                <span className="text-xs font-medium">Email</span>
                <Textarea
                  id={`body-${step.step}`}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  disabled={pending}
                  rows={12}
                  className="text-sm"
                />
              </label>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={pending || !dirty} onClick={() => save()}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
              {pending ? "Saving" : saved ? "Saved" : "Save"}
            </Button>
            {step.custom && (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={reset}>
                Back to the default wording
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

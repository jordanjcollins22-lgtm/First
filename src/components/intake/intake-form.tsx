"use client";

import { useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { INTAKE_QUESTIONS, type IntakeAnswers, type IntakeQuestion } from "@/lib/evaluation-intake";
import { submitEvaluationIntake } from "@/lib/actions/evaluation-intake-actions";

/**
 * The questions, one screen, thumb-sized.
 *
 * Chips rather than dropdowns because this is filled in on a phone in a
 * kitchen. Nothing is required: a half-answered form is worth more than an
 * abandoned one, and the evaluator fills the gaps at the door.
 */
export function IntakeForm({
  token,
  initial,
  submittedAt,
  together,
  businessPhone,
}: {
  token: string;
  initial: IntakeAnswers;
  submittedAt: string | null;
  together: boolean;
  businessPhone: string | null;
}) {
  const [answers, setAnswers] = useState<IntakeAnswers>(initial);
  const [done, setDone] = useState<string | null>(submittedAt);
  const [editing, setEditing] = useState(!submittedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function set<K extends keyof IntakeAnswers>(key: K, value: IntakeAnswers[K]) {
    setAnswers((a) => ({ ...a, [key]: value }));
  }

  function toggle(key: keyof IntakeAnswers, value: string, single: boolean) {
    const current = answers[key];
    if (single) return set(key, (current === value ? "" : value) as never);
    const list = Array.isArray(current) ? current : [];
    set(key, (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]) as never);
  }

  function send() {
    setError(null);
    start(async () => {
      const result = await submitEvaluationIntake({ token, answers, together });
      if (!result.ok) return setError(result.error);
      setDone(result.submittedAt);
      setEditing(false);
      window.scrollTo({ top: 0 });
    });
  }

  if (done && !editing) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
        <CheckCircle2 className="h-10 w-10 text-primary" />
        <p className="text-lg font-semibold">Got it, thank you</p>
        <p className="text-sm text-muted-foreground">
          {together
            ? "Saved. We can get on with the walk."
            : "We have read it and will come ready. If anything changes before the visit, reply to your booking email."}
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Change an answer
        </Button>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-7"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {together && (
        <p className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          Going through this together at the start of the visit. Five to ten minutes.
        </p>
      )}

      {INTAKE_QUESTIONS.map((q, index) => (
        <Question
          key={q.key}
          question={q}
          index={index + 1}
          answers={answers}
          disabled={pending}
          onToggle={(value) => toggle(q.key, value, q.kind === "single")}
          onText={(key, value) => set(key, value as never)}
        />
      ))}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? "Saving" : done ? "Save changes" : "Send"}
        </Button>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Skip anything you are not sure about. {businessPhone ? `Questions: call or text ${businessPhone}.` : ""}
        </p>
      </div>
    </form>
  );
}

function Question({
  question,
  index,
  answers,
  disabled,
  onToggle,
  onText,
}: {
  question: IntakeQuestion;
  index: number;
  answers: IntakeAnswers;
  disabled: boolean;
  onToggle: (value: string) => void;
  onText: (key: keyof IntakeAnswers, value: string) => void;
}) {
  const value = answers[question.key];
  const picked = (v: string) => (Array.isArray(value) ? value.includes(v) : value === v);
  const id = `q-${question.key}`;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-base font-semibold">
        <span className="mr-1.5 text-muted-foreground tabular-nums">{index}.</span>
        {question.title}
      </legend>
      {question.help && <p className="text-sm text-muted-foreground">{question.help}</p>}

      {question.kind === "text" ? (
        <Textarea
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onText(question.key, e.target.value)}
          disabled={disabled}
          rows={3}
          className="text-base"
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {(question.options ?? []).map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={picked(option.value)}
              onClick={() => onToggle(option.value)}
              className={cn(
                "min-h-11 rounded-full border px-4 text-sm",
                picked(option.value)
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border bg-background hover:bg-accent/50"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {question.notesKey && (
        <Textarea
          id={`${id}-notes`}
          value={answers[question.notesKey] as string}
          onChange={(e) => onText(question.notesKey!, e.target.value)}
          disabled={disabled}
          rows={2}
          placeholder={question.notesPlaceholder}
          className="text-base"
        />
      )}
    </fieldset>
  );
}

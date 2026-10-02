"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { applyForPosition } from "@/lib/actions/hiring-public-actions";
import type { Position, Question } from "@/lib/hiring/positions";

/**
 * The application: who they are, then the job's questions, one screen.
 * Passing goes straight on to the video; not passing gets a kind thank-you
 * and nothing about why, which is ours to know.
 */
export function ApplyForm({
  position,
  org,
  source,
  businessName,
}: {
  position: Position;
  org: string | null;
  source: string | null;
  businessName: string;
}) {
  const router = useRouter();
  const [contact, setContact] = useState({ name: "", email: "", phone: "", zip: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [website, setWebsite] = useState("");
  const [gaps, setGaps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [thanked, setThanked] = useState(false);
  const [sending, start] = useTransition();

  const set = (key: string, value: string) => setAnswers((prev) => ({ ...prev, [key]: value }));

  function send() {
    setError(null);
    setGaps([]);
    start(async () => {
      const result = await applyForPosition({ org, position: position.key, contact, answers, source, website }).catch(
        () => ({ ok: false as const, error: "We couldn't send that. Check your signal and try again.", missing: undefined })
      );
      if (!result.ok) {
        setError(result.error);
        setGaps(result.missing ?? []);
        return;
      }
      if (result.passed) router.push(`/careers/video/${result.token}`);
      else setThanked(true);
    });
  }

  if (thanked) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 text-center">
        <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
        <h2 className="mt-2 text-lg font-semibold">Thanks for applying</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          We read every application. If it looks like a match, someone from {businessName} will be in touch.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">Apply</h2>

      <div className="grid gap-3">
        <Field label="Full name">
          <Input autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" autoComplete="email" inputMode="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
        </Field>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Phone">
            <Input type="tel" autoComplete="tel" inputMode="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
          </Field>
          <Field label="ZIP code">
            <Input autoComplete="postal-code" inputMode="numeric" maxLength={5} value={contact.zip} onChange={(e) => setContact({ ...contact, zip: e.target.value.replace(/\D/g, "") })} />
          </Field>
        </div>
        {/* For bots only: hidden from people and from screen readers. */}
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
          className="absolute -left-[9999px] h-0 w-0 opacity-0"
        />
      </div>

      <ol className="flex flex-col gap-4">
        {position.questions.map((q) => (
          <li key={q.key}>
            <QuestionField question={q} value={answers[q.key] ?? ""} onChange={(v) => set(q.key, v)} />
          </li>
        ))}
      </ol>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-medium text-destructive">{error}</p>
          {gaps.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Button type="button" onClick={send} disabled={sending} className="h-12 text-base font-semibold">
        {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Send application
      </Button>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

function QuestionField({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  const choices = question.kind === "yesno" ? (["yes", "no"] as const) : question.kind === "choice" ? question.options ?? [] : null;
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{question.label}</legend>
      {question.hint && <p className="-mt-1 text-xs text-muted-foreground">{question.hint}</p>}
      {choices ? (
        <div className={question.kind === "yesno" ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
          {choices.map((choice) => {
            const on = value === choice;
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(choice)}
                className={`min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  on ? "border-primary bg-primary/10 font-semibold text-foreground" : "border-border bg-background hover:border-primary/40"
                }`}
              >
                {choice === "yes" ? "Yes" : choice === "no" ? "No" : choice}
              </button>
            );
          })}
        </div>
      ) : (
        <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </fieldset>
  );
}

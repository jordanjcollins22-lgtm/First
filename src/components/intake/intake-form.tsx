"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, ChevronDown, Loader2, MessageCircleQuestion, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  answersForConcerns,
  BEFORE_VISIT_QUESTIONS,
  detailQuestionsFor,
  INTAKE_QUESTIONS,
  MAX_INTAKE_PHOTOS,
  type DetailQuestion,
  type IntakeAnswer,
  type IntakeAnswers,
  type IntakeOption,
  type IntakeQuestion,
  type IntakeSection,
} from "@/lib/evaluation-intake";
import { addIntakePhoto, removeIntakePhoto, submitEvaluationIntake } from "@/lib/actions/evaluation-intake-actions";
import { shrinkImage } from "@/lib/shrink-image";

type Photo = { path: string; url: string };

const SECTION_TITLE: Record<IntakeSection, string> = {
  work: "The work",
  style: "Your style",
  decide: "Before you decide",
  ask: "Anything else",
};

/**
 * The questions, one screen, thumb-sized.
 *
 * Chips rather than dropdowns because this is filled in on a phone in a
 * kitchen. Nothing is required: a half-answered form is worth more than an
 * abandoned one, and the evaluator fills the gaps at the door.
 *
 * In order: what they want, the details that set its price (only for what
 * they ticked), photos, their style, then what would stop them, answered as
 * they tick it, and the questions people usually ask before a visit.
 */
export function IntakeForm({
  token,
  initial,
  initialPhotos,
  submittedAt,
  together,
  businessPhone,
}: {
  token: string;
  initial: IntakeAnswers;
  initialPhotos: Photo[];
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

  function toggleIn(current: string | string[] | undefined, value: string, single: boolean): string | string[] {
    if (single) return current === value ? "" : value;
    const list = Array.isArray(current) ? current : [];
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function setDetail(id: string, value: string | string[]) {
    setAnswers((a) => ({ ...a, details: { ...a.details, [id]: value } }));
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

  const question = (q: IntakeQuestion) => (
    <Question
      key={q.key}
      title={q.title}
      help={q.help}
      kind={q.kind}
      options={q.options}
      value={answers[q.key]}
      disabled={pending}
      onToggle={(value) => set(q.key, toggleIn(answers[q.key], value, q.kind === "single") as never)}
      onText={(value) => set(q.key, value as never)}
      notes={q.notesKey ? { value: answers[q.notesKey] as string, placeholder: q.notesPlaceholder, onChange: (v) => set(q.notesKey!, v as never) } : undefined}
    >
      {q.key === "concerns" && <ConcernAnswers answers={answersForConcerns(answers.concerns)} />}
    </Question>
  );
  const inSection = (section: IntakeSection) => INTAKE_QUESTIONS.filter((q) => q.section === section).map(question);
  const details = detailQuestionsFor(answers.services);
  const forWork = details.filter((q) => q.services !== null);
  const forProperty = details.filter((q) => q.services === null);
  const detail = (q: DetailQuestion) => (
    <Question
      key={q.id}
      title={q.title}
      kind={q.kind}
      options={q.options}
      placeholder={q.placeholder}
      value={answers.details[q.id]}
      small
      disabled={pending}
      onToggle={(value) => setDetail(q.id, toggleIn(answers.details[q.id], value, q.kind === "single"))}
      onText={(value) => setDetail(q.id, value)}
    />
  );

  return (
    <form
      className="flex flex-col gap-9"
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

      <Section number={1} title={SECTION_TITLE.work}>
        {inSection("work")}
      </Section>

      <Section
        number={2}
        title="Details for your price"
        help="The things a tape measure does not show. They let us price it properly, often before we arrive."
      >
        {groupsOf(forWork).map(([group, questions]) => (
          <div key={group} className="flex flex-col gap-5 rounded-xl bg-muted/40 p-3">
            <p className="-mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{group}</p>
            {questions.map(detail)}
          </div>
        ))}
        {forProperty.map(detail)}
        <Photos token={token} initial={initialPhotos} disabled={pending} />
      </Section>

      <Section number={3} title={SECTION_TITLE.style}>
        {inSection("style")}
      </Section>

      <Section number={4} title={SECTION_TITLE.decide}>
        {inSection("decide")}
      </Section>

      <Section number={5} title="What people ask before we come">
        <FrequentQuestions />
        {inSection("ask")}
      </Section>

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

/** The questions under the heading of the work they are about, in order. */
function groupsOf(questions: DetailQuestion[]): [string, DetailQuestion[]][] {
  const groups = new Map<string, DetailQuestion[]>();
  for (const q of questions) groups.set(q.group, [...(groups.get(q.group) ?? []), q]);
  return [...groups];
}

function Section({ number, title, help, children }: { number: number; title: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-6">
      <div className="border-b border-border pb-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {number}
          </span>
          {title}
        </h2>
        {help && <p className="mt-1 text-sm text-muted-foreground">{help}</p>}
      </div>
      {children}
    </section>
  );
}

function Question({
  title,
  help,
  kind,
  options,
  placeholder,
  value,
  small = false,
  disabled,
  onToggle,
  onText,
  notes,
  children,
}: {
  title: string;
  help?: string;
  kind: "multi" | "single" | "text";
  options?: IntakeOption[];
  placeholder?: string;
  value: string | string[] | undefined;
  small?: boolean;
  disabled: boolean;
  onToggle: (value: string) => void;
  onText: (value: string) => void;
  notes?: { value: string; placeholder?: string; onChange: (value: string) => void };
  children?: React.ReactNode;
}) {
  const picked = (v: string) => (Array.isArray(value) ? value.includes(v) : value === v);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={cn("font-semibold", small ? "text-sm" : "text-base")}>{title}</legend>
      {help && <p className="text-sm text-muted-foreground">{help}</p>}

      {kind === "text" ? (
        <Textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onText(e.target.value)}
          disabled={disabled}
          rows={small ? 2 : 3}
          placeholder={placeholder}
          className="text-base"
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {(options ?? []).map((option) => (
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

      {children}

      {notes && (
        <Textarea
          value={notes.value}
          onChange={(e) => notes.onChange(e.target.value)}
          disabled={disabled}
          rows={2}
          placeholder={notes.placeholder}
          className="text-base"
        />
      )}
    </fieldset>
  );
}

/** The answer to each worry they ticked, right under the chips. */
function ConcernAnswers({ answers }: { answers: IntakeAnswer[] }) {
  if (answers.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {answers.map((a) => (
        <div key={a.heading} className="rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-primary">
            <MessageCircleQuestion className="h-4 w-4 shrink-0" />
            {a.heading}
          </p>
          <p className="mt-1 text-sm leading-relaxed">{a.body}</p>
        </div>
      ))}
    </div>
  );
}

/** Tap a question to read the answer. */
function FrequentQuestions() {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
      {BEFORE_VISIT_QUESTIONS.map((q) => (
        <li key={q.heading}>
          <details className="group px-3 py-2.5">
            <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              {q.heading}
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{q.body}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}

/**
 * Photos of the areas. Each one is shrunk on the phone and saved the moment
 * it is picked, so none are lost if they close the page before Send.
 */
function Photos({ token, initial, disabled }: { token: string; initial: Photo[]; disabled: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Photo[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const room = MAX_INTAKE_PHOTOS - photos.length;

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, room)) {
        const small = await shrinkImage(file, 1600, 0.8);
        const form = new FormData();
        form.set("token", token);
        form.set("file", small);
        const result = await addIntakePhoto(form);
        if (!result.ok) {
          setError(result.error);
          break;
        }
        setPhotos((all) => [...all, { path: result.path, url: result.url }]);
      }
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(path: string) {
    setError(null);
    const result = await removeIntakePhoto({ token, path });
    if (!result.ok) return setError(result.error);
    setPhotos((all) => all.filter((p) => p.path !== path));
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-semibold">Photos of the areas</legend>
      <p className="text-sm text-muted-foreground">One of each area from where you would stand to show someone. Up to {MAX_INTAKE_PHOTOS}.</p>
      <div className="grid grid-cols-4 gap-2">
        {photos.map((p) => (
          <div key={p.path} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
            {/* Signed links to a private bucket, so a plain img rather than the image optimiser. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              aria-label="Remove this photo"
              disabled={disabled || busy}
              onClick={() => remove(p.path)}
              className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {room > 0 && (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => input.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-xs text-muted-foreground hover:bg-accent/50"
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
            {busy ? "Adding" : "Add"}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </fieldset>
  );
}

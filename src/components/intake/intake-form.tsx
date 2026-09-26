"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowLeft, Camera, CheckCircle2, ChevronDown, Loader2, MessageCircleQuestion, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  answersForConcerns,
  BEFORE_VISIT_QUESTIONS,
  detailQuestionsFor,
  INTAKE_QUESTIONS,
  MAX_INTAKE_PHOTOS,
  notesShown,
  type DetailQuestion,
  type IntakeAnswers,
  type IntakeOption,
  type IntakeQuestion,
} from "@/lib/evaluation-intake";
import { addIntakePhoto, removeIntakePhoto, saveIntakeProgress, submitEvaluationIntake } from "@/lib/actions/evaluation-intake-actions";
import { shrinkImage } from "@/lib/shrink-image";

type Photo = { path: string; url: string };

/** One screen of the form. */
type Step =
  | { key: string; kind: "main"; question: IntakeQuestion }
  | { key: string; kind: "detail"; question: DetailQuestion }
  | { key: "photos"; kind: "photos" }
  | { key: "last"; kind: "last" };

const main = (key: IntakeQuestion["key"]): Step => {
  const question = INTAKE_QUESTIONS.find((q) => q.key === key)!;
  return { key, kind: "main", question };
};

/**
 * The screens, in order, for the answers so far. What they tick on the
 * first screen decides which pricing questions follow, and an answer can
 * bring in a follow-up (sod or seed after a lawn repair), so this is worked
 * out again after every answer.
 */
function stepsFor(answers: IntakeAnswers): Step[] {
  const details = detailQuestionsFor(answers.services, answers.details);
  return [
    main("services"),
    main("areas"),
    ...details.map((question): Step => ({ key: `d:${question.id}`, kind: "detail", question })),
    { key: "photos", kind: "photos" },
    main("looks"),
    main("tried"),
    main("concerns"),
    main("budget"),
    main("timing"),
    main("decision"),
    { key: "last", kind: "last" },
  ];
}

function filled(value: string | string[] | undefined): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

function answered(step: Step, answers: IntakeAnswers, photos: Photo[]): boolean {
  if (step.kind === "main") return filled(answers[step.question.key]);
  if (step.kind === "detail") return filled(answers.details[step.question.id]);
  if (step.kind === "photos") return photos.length > 0;
  return false;
}

/** The answers with this screen's answer written in. */
function write(answers: IntakeAnswers, step: Step, value: string | string[]): IntakeAnswers {
  if (step.kind === "main") return { ...answers, [step.question.key]: value };
  if (step.kind === "detail") return { ...answers, details: { ...answers.details, [step.question.id]: value } };
  return answers;
}

/**
 * The questions, one at a time.
 *
 * A question with one answer moves on the moment it is tapped; one with
 * several, or with words to type, has a Next. Back is always there, and
 * everything can be skipped: a half-answered form is worth more than an
 * abandoned one, and the evaluator fills the gaps at the door. Each answer
 * is saved as they go, so closing it partway loses nothing, and opening it
 * again picks up at the first question not yet answered.
 */
export function IntakeForm({
  token,
  initial,
  initialPhotos,
  submittedAt,
  together,
  businessPhone,
  greeting,
  demo = false,
}: {
  token: string;
  initial: IntakeAnswers;
  initialPhotos: Photo[];
  submittedAt: string | null;
  together: boolean;
  businessPhone: string | null;
  /** Said above the first question. */
  greeting?: string;
  /** A look at the form with nothing saved anywhere: for the owner to try it. */
  demo?: boolean;
}) {
  const [answers, setAnswers] = useState<IntakeAnswers>(initial);
  const [photos, setPhotos] = useState<Photo[]>(initialPhotos);
  const [done, setDone] = useState<string | null>(submittedAt);
  const [editing, setEditing] = useState(!submittedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Set while a tapped answer is about to move on, so a double tap moves once.
  const advancing = useRef(false);
  // Where they are, by the screen's key, because the list around it changes.
  const [at, setAt] = useState<string>(() => {
    const steps = stepsFor(initial);
    if (submittedAt) return steps[0].key;
    return (steps.find((s) => s.kind !== "last" && !answered(s, initial, initialPhotos)) ?? steps[steps.length - 1]).key;
  });

  const steps = stepsFor(answers);
  const index = Math.max(0, steps.findIndex((s) => s.key === at));
  const step = steps[index];

  function go(to: number, withAnswers: IntakeAnswers = answers) {
    const list = stepsFor(withAnswers);
    setAt(list[Math.min(Math.max(to, 0), list.length - 1)].key);
    window.scrollTo({ top: 0 });
    // Kept as they go. If this one fails, Send saves everything anyway.
    if (!demo) void saveIntakeProgress({ token, answers: withAnswers }).catch(() => undefined);
  }

  function next(withAnswers: IntakeAnswers = answers) {
    const list = stepsFor(withAnswers);
    go(list.findIndex((s) => s.key === step.key) + 1, withAnswers);
  }

  function choose(value: string, single: boolean) {
    if (advancing.current) return;
    const current = step.kind === "main" ? answers[step.question.key] : step.kind === "detail" ? answers.details[step.question.id] : undefined;
    const list = Array.isArray(current) ? current : [];
    const picked = single ? value : list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    const updated = write(answers, step, picked);
    setAnswers(updated);
    // One answer: tapped is answered. A short pause so they see it land.
    if (single) {
      advancing.current = true;
      setTimeout(() => {
        advancing.current = false;
        next(updated);
      }, 220);
    }
  }

  function send() {
    setError(null);
    start(async () => {
      const result = demo ? { ok: true as const, submittedAt: new Date().toISOString() } : await submitEvaluationIntake({ token, answers, together });
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setAt(steps[0].key);
            setEditing(true);
          }}
        >
          Change an answer
        </Button>
      </div>
    );
  }

  const isLast = step.kind === "last";
  const notesWritten = step.kind === "main" && step.question.notesKey ? Boolean(answers[step.question.notesKey]) : false;
  const moveOn = answered(step, answers, photos) || notesWritten;

  return (
    <div className="flex flex-1 flex-col">
      {together && index === 0 && (
        <p className="mb-4 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          Going through this together at the start of the visit. Five to ten minutes.
        </p>
      )}

      <Progress index={index} total={steps.length} />

      <div key={step.key} className="flex flex-1 flex-col gap-3 pt-5 animate-in fade-in slide-in-from-right-4 duration-200">
        {index === 0 && greeting && <p className="text-sm text-muted-foreground">{greeting}</p>}

        {step.kind === "main" && (
          <Question
            title={step.question.title}
            help={step.question.help}
            kind={step.question.kind}
            options={step.question.options}
            value={answers[step.question.key]}
            disabled={pending}
            onChoose={choose}
            onText={(v) => setAnswers((a) => write(a, step, v))}
            onEnter={() => next()}
          >
            {step.question.key === "concerns" && <ConcernAnswers concerns={answers.concerns} />}
            {step.question.notesKey && notesShown(step.question, answers) && (
              <Textarea
                value={answers[step.question.notesKey] as string}
                onChange={(e) => setAnswers((a) => ({ ...a, [step.question.notesKey!]: e.target.value }))}
                disabled={pending}
                rows={2}
                placeholder={step.question.notesPlaceholder}
                className="text-base"
              />
            )}
          </Question>
        )}

        {step.kind === "detail" && (
          <Question
            eyebrow={step.question.group}
            title={step.question.title}
            kind={step.question.kind}
            options={step.question.options}
            placeholder={step.question.placeholder}
            value={answers.details[step.question.id]}
            disabled={pending}
            onChoose={choose}
            onText={(v) => setAnswers((a) => write(a, step, v))}
            onEnter={() => next()}
          >
            {step.question.placeholder && step.question.kind !== "text" && (
              <Textarea
                value={String(answers.details[`${step.question.id}_notes`] ?? "")}
                onChange={(e) => setAnswers((a) => ({ ...a, details: { ...a.details, [`${step.question.id}_notes`]: e.target.value } }))}
                disabled={pending}
                rows={2}
                placeholder={step.question.placeholder}
                className="text-base"
              />
            )}
          </Question>
        )}

        {step.kind === "photos" && <Photos token={token} photos={photos} setPhotos={setPhotos} disabled={pending || demo} />}

        {isLast && (
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold leading-snug">Anything you want to ask us before we come?</h2>
            <FrequentQuestions />
            <Textarea
              value={answers.questions}
              onChange={(e) => setAnswers((a) => ({ ...a, questions: e.target.value }))}
              disabled={pending}
              rows={3}
              placeholder="Ask anything else here"
              className="text-base"
            />
          </div>
        )}
      </div>

      {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-border bg-background/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          {index > 0 && (
            <Button type="button" variant="outline" size="icon" aria-label="Back" disabled={pending} onClick={() => go(index - 1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}
          {isLast ? (
            <Button type="button" className="flex-1" disabled={pending} onClick={send}>
              {pending ? "Sending" : done ? "Save changes" : "Send"}
            </Button>
          ) : (
            <Button type="button" className="flex-1" variant={moveOn ? "default" : "outline"} disabled={pending} onClick={() => next()}>
              {moveOn ? "Next" : "Skip"}
            </Button>
          )}
        </div>
        {/* Said once, where it helps: skipping on the first screen, the phone on the last. */}
        {(index === 0 || isLast) && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {index === 0 ? "Skip anything you are not sure about." : businessPhone ? `Rather talk? Call or text ${businessPhone}.` : ""}
          </p>
        )}
      </div>
    </div>
  );
}

function Progress({ index, total }: { index: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-300" style={{ width: `${Math.round(((index + 1) / total) * 100)}%` }} />
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {index + 1} of {total}
      </span>
    </div>
  );
}

function Question({
  eyebrow,
  title,
  help,
  kind,
  options,
  placeholder,
  value,
  disabled,
  onChoose,
  onText,
  onEnter,
  children,
}: {
  eyebrow?: string;
  title: string;
  help?: string;
  kind: "multi" | "single" | "text";
  options?: IntakeOption[];
  placeholder?: string;
  value: string | string[] | undefined;
  disabled: boolean;
  onChoose: (value: string, single: boolean) => void;
  onText: (value: string) => void;
  onEnter: () => void;
  children?: React.ReactNode;
}) {
  const picked = (v: string) => (Array.isArray(value) ? value.includes(v) : value === v);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (kind === "text") ref.current?.focus();
  }, [kind]);

  return (
    <div className="flex flex-col gap-3">
      {eyebrow && <p className="-mb-2 text-xs font-semibold uppercase tracking-wide text-primary">{eyebrow}</p>}
      <h2 className="text-xl font-semibold leading-snug">{title}</h2>
      {help && <p className="-mt-1 text-sm text-muted-foreground">{help}</p>}
      {kind === "multi" && !help && <p className="-mt-1 text-xs text-muted-foreground">Tick all that apply, then Next.</p>}

      {kind === "text" ? (
        <Textarea
          ref={ref}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onEnter();
            }
          }}
          disabled={disabled}
          rows={4}
          placeholder={placeholder}
          className="text-base"
        />
      ) : (
        <div className="flex flex-col gap-1.5">
          {(options ?? []).map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={picked(option.value)}
              onClick={() => onChoose(option.value, kind === "single")}
              className={cn(
                "flex min-h-11 items-center justify-between gap-3 rounded-xl border px-4 py-2 text-left text-base transition-colors",
                picked(option.value) ? "border-primary bg-primary/10 font-medium text-primary" : "border-border bg-background hover:bg-accent/50"
              )}
            >
              {option.label}
              {picked(option.value) && <CheckCircle2 className="h-5 w-5 shrink-0" />}
            </button>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}

/** The answer to each worry they ticked, right under the choices. */
function ConcernAnswers({ concerns }: { concerns: string[] }) {
  const answers = answersForConcerns(concerns);
  const newest = useRef<HTMLDivElement>(null);
  const count = answers.length;
  // The answer lands below the choices, so bring it into view as it appears.
  useEffect(() => {
    if (count > 0) newest.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [count]);
  if (answers.length === 0) return null;
  const last = concerns.length ? answersForConcerns([concerns[concerns.length - 1]])[0]?.heading : undefined;
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      {answers.map((a) => (
        <div
          key={a.heading}
          ref={a.heading === last ? newest : undefined}
          className="scroll-mb-28 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5"
        >
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
function Photos({
  token,
  photos,
  setPhotos,
  disabled,
}: {
  token: string;
  photos: Photo[];
  setPhotos: React.Dispatch<React.SetStateAction<Photo[]>>;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
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
    <div className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold leading-snug">Can you add a few photos?</h2>
      <p className="-mt-1 text-sm text-muted-foreground">
        One of each area, from where you would stand to show someone. It lets us price it properly, often before we arrive. Up to{" "}
        {MAX_INTAKE_PHOTOS}.
      </p>
      <div className="grid grid-cols-3 gap-2">
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
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-accent/50"
          >
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
            {busy ? "Adding" : "Add photos"}
          </button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => add(e.target.files)} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

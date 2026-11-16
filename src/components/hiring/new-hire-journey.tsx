"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, Loader2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { logJourneyStep, setJourneyDetails, undoJourneyStep } from "@/lib/actions/journey-actions";
import { cultureFor, type RoleDoc } from "@/lib/hiring/role-docs";
import {
  LEVEL_LABEL,
  PHASE_LABEL,
  TRAINING_LABEL,
  TRAINING_PHASES,
  trainingKey,
  type CheckInPhase,
  type CheckInSlot,
  type Level,
} from "@/lib/hiring/journey";
import type { StepRow } from "@/lib/data/journey";

/**
 * One new hire, from day one to fully operating: the plan and culture gone
 * through, their buddy, today's check-ins, training sign-offs task by task,
 * the 30-60-90 reviews, and where they are on Alex's three levels.
 */

export interface JourneyProps {
  id: string;
  name: string;
  positionTitle: string;
  day: number;
  doc: RoleDoc;
  buddyName: string | null;
  ownsChecklists: boolean;
  phase: CheckInPhase;
  /** Check-ins due today, and any missed in the last two weeks, newest first. */
  checkIns: (CheckInSlot & { missed: boolean })[];
  reviewDates: { day: 30 | 60 | 90; date: string; due: boolean }[];
  steps: StepRow[];
  fully: { reached: boolean; missing: string[] };
  level: Level;
}

function done(steps: StepRow[], kind: StepRow["kind"], key: string): StepRow | undefined {
  return steps.find((s) => s.kind === kind && s.key === key);
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NewHireJourney(p: JourneyProps) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [buddy, setBuddy] = useState(p.buddyName ?? "");

  function log(kind: StepRow["kind"], key: string) {
    setError(null);
    start(async () => {
      const r = await logJourneyStep({ checklistId: p.id, kind, key, note: notes[`${kind}:${key}`] });
      if (!r.ok) setError(r.message);
      else router.refresh();
    });
  }
  function undo(kind: StepRow["kind"], key: string) {
    setError(null);
    start(async () => {
      const r = await undoJourneyStep({ checklistId: p.id, kind, key });
      if (!r.ok) setError(r.message);
      else router.refresh();
    });
  }
  function save(patch: { buddyName?: string; ownsChecklists?: boolean }) {
    setError(null);
    start(async () => {
      const r = await setJourneyDetails({ checklistId: p.id, ...patch });
      if (!r.ok) setError(r.message);
      else router.refresh();
    });
  }

  const doneLine = (row: StepRow, kind: StepRow["kind"], k: string) => (
    <span className="flex flex-wrap items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
      <Check className="h-3.5 w-3.5" /> {when(row.doneAt)}
      {row.doneByName ? ` by ${row.doneByName}` : ""}
      {row.note ? <span className="text-muted-foreground">· {row.note}</span> : null}
      <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => undo(kind, k)} disabled={busy} aria-label="Undo">
        <Undo2 className="h-3.5 w-3.5" />
      </button>
    </span>
  );

  const noteAndLog = (kind: StepRow["kind"], k: string, label: string) => (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        id={`note-${kind}-${k}`}
        className="h-8 min-w-0 flex-1 text-sm"
        placeholder="Notes (optional)"
        value={notes[`${kind}:${k}`] ?? ""}
        onChange={(e) => setNotes({ ...notes, [`${kind}:${k}`]: e.target.value })}
      />
      <Button type="button" size="sm" disabled={busy} onClick={() => log(kind, k)}>
        {label}
      </Button>
    </div>
  );

  const plan = done(p.steps, "plan", "plan");
  const culture = done(p.steps, "culture", "culture");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <Link href="/admin/hiring#new-hires" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Hiring
      </Link>

      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          {p.positionTitle} · day {Math.max(1, p.day)}
        </p>
        <h1 className="text-2xl font-bold">{p.name}</h1>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">Check-ins: {PHASE_LABEL[p.phase]}</span>
          <span className="rounded-full bg-muted px-2 py-0.5">{LEVEL_LABEL[p.level]}</span>
          <span className={`rounded-full px-2 py-0.5 ${p.fully.reached ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-amber-500/15 text-amber-700 dark:text-amber-400"}`}>
            {p.fully.reached ? "Fully operating" : "Not fully operating yet"}
          </span>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </header>

      <Section title="Their 30-60-90 plan" sub="Go through it with them before day one. The reviews below are measured against it.">
        <ol className="grid gap-2 sm:grid-cols-3">
          {p.doc.plan.map((m) => (
            <li key={m.day} className="rounded-xl border border-border bg-card p-3 text-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Day {m.day}</p>
              <p className="mt-1">{m.goal}</p>
              <p className="mt-2 text-xs text-muted-foreground">Problem to solve: {m.problem}</p>
            </li>
          ))}
        </ol>
        {plan ? doneLine(plan, "plan", "plan") : noteAndLog("plan", "plan", "Went through it with them")}
      </Section>

      <Section title="Culture" sub="In the first two weeks, with real examples and the people who best show it.">
        <ul className="space-y-1 text-sm">
          {cultureFor(p.doc.position).map((c) => (
            <li key={c.value}>
              <span className="font-semibold">{c.value}. </span>
              <span className="text-muted-foreground">{c.looksLike}</span>
            </li>
          ))}
        </ul>
        {culture ? doneLine(culture, "culture", "culture") : noteAndLog("culture", "culture", "Went through it with them")}
      </Section>

      <Section title="Their buddy" sub="Someone who isn't their boss, to ask anything. Plus time seeing other parts of the business.">
        <div className="flex flex-wrap items-center gap-2">
          <Input id="buddy" className="h-8 min-w-0 flex-1 text-sm" placeholder="Buddy's name" value={buddy} onChange={(e) => setBuddy(e.target.value)} />
          <Button type="button" size="sm" variant="secondary" disabled={busy || buddy === (p.buddyName ?? "")} onClick={() => save({ buddyName: buddy })}>
            Save
          </Button>
        </div>
      </Section>

      <Section
        title="Check-ins"
        sub="Twice a day for the first two weeks, then once a day, then twice a week to day 60, then a weekly one-on-one. Honest feedback both ways; after week one, ask for their fresh-eyes notes."
      >
        {p.checkIns.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">No check-in due today.</p>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {p.checkIns.map((c) => {
              const row = done(p.steps, "checkin", c.key);
              return (
                <li key={c.key} className="space-y-1.5 px-3 py-2">
                  <p className="text-sm font-medium">
                    {c.label} · {when(`${c.date}T12:00:00Z`)}
                    {c.missed && !row ? <span className="ml-2 text-xs font-semibold text-amber-700 dark:text-amber-400">missed</span> : null}
                  </p>
                  {row ? doneLine(row, "checkin", c.key) : noteAndLog("checkin", c.key, "Held it")}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="Training" sub="For each task: you show them with the checklist, they do it while you watch, then they're released to do it alone.">
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Task</th>
                {TRAINING_PHASES.map((ph) => (
                  <th key={ph} className="px-2 py-2 font-medium">
                    {TRAINING_LABEL[ph]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.doc.tasks.map((t) => {
                let blocked = false;
                return (
                  <tr key={t.key} className="border-b border-border last:border-0 align-top">
                    <td className="px-3 py-2 font-medium">{t.title}</td>
                    {TRAINING_PHASES.map((ph) => {
                      const k = trainingKey(t.key, ph);
                      const row = done(p.steps, "training", k);
                      const cell = row ? (
                        doneLine(row, "training", k)
                      ) : blocked ? (
                        <span className="text-xs text-muted-foreground">After the step before</span>
                      ) : (
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => log("training", k)}>
                          Sign off
                        </Button>
                      );
                      if (!row) blocked = true;
                      return (
                        <td key={ph} className="px-2 py-2">
                          {cell}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Link href={`/admin/hiring/jobs/${p.doc.position}`} className="text-sm text-primary hover:underline">
          See the task checklists
        </Link>
      </Section>

      <Section title="30-60-90 reviews" sub="A progress review against their plan.">
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {p.reviewDates.map((r) => {
            const k = String(r.day);
            const row = done(p.steps, "review", k);
            const goal = p.doc.plan.find((m) => m.day === r.day)?.goal;
            return (
              <li key={k} className="space-y-1.5 px-3 py-2">
                <p className="text-sm font-medium">
                  Day {r.day} review · {when(`${r.date}T12:00:00Z`)}
                </p>
                {goal ? <p className="text-xs text-muted-foreground">Against: {goal}</p> : null}
                {row ? doneLine(row, "review", k) : r.due ? noteAndLog("review", k, "Review done") : <p className="text-xs text-muted-foreground">Not due yet.</p>}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Fully operating" sub="Reached when check-ins are down to weekly one-on-ones, every task is released, and the day 30 and 60 reviews are done.">
        {p.fully.reached ? (
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Fully operating. Managing them is now feedback, retraining, rewards and recruiting.</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {p.fully.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Levels of growth" sub="Alex Hormozi's three levels. Each one needs the one below.">
        <ol className="space-y-1 text-sm">
          <li className={p.level === "none" ? "text-muted-foreground" : ""}>1. Individual contributor: released on every task (knows what to do).</li>
          <li className={p.level === "manager" || p.level === "leader" ? "" : "text-muted-foreground"}>
            2. Manager: has shown and watched someone else on a task (knows how, well enough to teach).
          </li>
          <li className={p.level === "leader" ? "" : "text-muted-foreground"}>3. Leader: writes and keeps up the task checklists, so the system does the teaching.</li>
        </ol>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={p.ownsChecklists} disabled={busy} onChange={(e) => save({ ownsChecklists: e.target.checked })} />
          They write and keep up the task checklists
        </label>
      </Section>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        {sub ? <p className="text-sm text-muted-foreground">{sub}</p> : null}
      </div>
      {children}
    </section>
  );
}

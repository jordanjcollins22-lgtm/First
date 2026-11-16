import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import type { Position } from "@/lib/hiring/positions";
import { cultureFor, type RoleDoc } from "@/lib/hiring/role-docs";
import { skillsStepFor } from "@/lib/hiring/screening";

/**
 * One job written down (hiring structure 0.1 and 0.4), with what training
 * runs on (11, 12, 15). The same page is shown to the person hiring and,
 * later, to the new hire.
 */
export function RoleDocView({ position, doc }: { position: Position; doc: RoleDoc }) {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
      <Link href="/admin/hiring" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Hiring
      </Link>
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Job documents</p>
        <h1 className="text-2xl font-bold">{position.title}</h1>
        <p className="text-sm text-muted-foreground">
          The role, the Four Rs, a perfect day, the 30-60-90 plan, our culture and the task checklists training runs on. A first draft for the owner to change.
        </p>
      </header>

      <Section title="The role">
        <p className="text-sm">
          <span className="font-semibold">The problem this hire solves: </span>
          {doc.problem}
        </p>
        <TwoLists a={{ title: "What they should achieve", items: doc.achieve }} b={{ title: "What they should avoid", items: doc.avoid }} />
      </Section>

      <Section title="The Four Rs">
        <div className="grid gap-4 sm:grid-cols-2">
          <List title="Roles" items={doc.roles} />
          <List title="Responsibilities" items={doc.responsibilities} />
          <List title="Requirements" items={doc.requirements} />
          <List title="Results" items={doc.results} />
        </div>
      </Section>

      <Section title="A perfect day">
        <ol className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {doc.perfectDay.map((d) => (
            <li key={d.time} className="flex gap-3 px-3 py-2">
              <span className="w-24 shrink-0 font-semibold tabular-nums">{d.time}</span>
              <span className="min-w-0">{d.what}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="The skills step in hiring">
        <p className="text-sm">{skillsStepFor(position.key)}</p>
      </Section>

      <Section title="30-60-90 day plan">
        <ol className="grid gap-2 sm:grid-cols-3">
          {doc.plan.map((m) => (
            <li key={m.day} className="rounded-xl border border-border bg-card p-3 text-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Day {m.day}</p>
              <p className="mt-1">{m.goal}</p>
              <p className="mt-2 text-xs text-muted-foreground">Problem to solve: {m.problem}</p>
            </li>
          ))}
        </ol>
        {doc.firstTwoWeeks && doc.firstTwoWeeks.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-semibold">The first two weeks</p>
            <ol className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
              {doc.firstTwoWeeks.map((d) => (
                <li key={d.when} className="flex gap-3 px-3 py-2">
                  <span className="w-16 shrink-0 font-semibold">{d.when}</span>
                  <span className="min-w-0">{d.what}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Section>

      {doc.seeTheBusiness && doc.seeTheBusiness.length > 0 && (
        <Section title="Seeing the rest of the business">
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {doc.seeTheBusiness.map((b) => (
              <li key={b.key}>{b.what}</li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Our culture">
        <ul className="space-y-2 text-sm">
          {cultureFor(position.key).map((c) => (
            <li key={c.value}>
              <span className="font-semibold">{c.value}. </span>
              <span className="text-muted-foreground">{c.looksLike}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Task checklists">
        <p className="text-sm text-muted-foreground">
          Each one is shown to the new hire, done by them while you watch, then they&apos;re released on it. Questions they ask get added here.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {doc.tasks.map((t) => (
            <div key={t.key} className="rounded-xl border border-border bg-card p-3">
              <p className="font-semibold">{t.title}</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm">
                {t.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  );
}

function TwoLists({ a, b }: { a: { title: string; items: readonly string[] }; b: { title: string; items: readonly string[] } }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <List title={a.title} items={a.items} />
      <List title={b.title} items={b.items} />
    </div>
  );
}

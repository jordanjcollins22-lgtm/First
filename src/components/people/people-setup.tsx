"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveTemplate } from "@/lib/actions/people-actions";
import type { TemplateRow } from "@/lib/data/people";
import { ONBOARDING_PARTS, STAGE_KEYS, STAGE_LABEL, type PersonStage } from "@/lib/people/lifecycle";
import { DEFINITIONS, SOPS } from "@/lib/people/sops";
import { PeopleNav } from "@/components/people/people-nav";

export function PeopleSetup({ templates }: { templates: TemplateRow[] }) {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-xl font-semibold">Checklists and SOPs</h1>
        <p className="mt-1 text-sm text-muted-foreground">Legal items are marked apart from company preferences. Completing a checklist doesn&apos;t replace legal compliance.</p>
      </header>
      <PeopleNav active="setup" />
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Reusable checklists</h2>
        {STAGE_KEYS.filter((s) => s !== "advancement").map((stage) => (
          <StageChecklist key={stage} stage={stage} items={templates.filter((t) => t.stage === stage)} />
        ))}
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Standard definitions</h2>
        <dl className="divide-y divide-border rounded-xl border border-border bg-card text-sm">
          {DEFINITIONS.map((d) => (
            <div key={d.term} className="p-3"><dt className="font-medium">{d.term}</dt><dd className="mt-0.5 text-muted-foreground">{d.meaning}</dd></div>
          ))}
        </dl>
      </section>
      <section className="space-y-2">
        <h2 className="text-base font-semibold">Standard operating procedures</h2>
        {SOPS.map((s) => (
          <details key={s.stage} className="rounded-xl border border-border bg-card p-3 text-sm">
            <summary className="cursor-pointer font-medium">{s.name}</summary>
            <dl className="mt-3 grid gap-2">
              {([["Definition", s.definition], ["Purpose", s.purpose], ["Owner", s.owner], ["Trigger", s.trigger], ["Inputs", s.inputs]] as const).map(([k, v]) => <Row key={k} k={k} v={v} />)}
              <div><dt className="font-medium">Procedure</dt><dd><ol className="mt-1 list-decimal space-y-0.5 pl-5 text-muted-foreground">{s.procedure.map((p) => <li key={p}>{p}</li>)}</ol></dd></div>
              {([["Standards", s.standards], ["Completion Criteria", s.completion], ["Exceptions", s.exceptions], ["Next Step", s.next]] as const).map(([k, v]) => <Row key={k} k={k} v={v} />)}
            </dl>
          </details>
        ))}
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div><dt className="font-medium">{k}</dt><dd className="text-muted-foreground">{v}</dd></div>;
}

function StageChecklist({ stage, items }: { stage: PersonStage; items: TemplateRow[] }) {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [part, setPart] = useState<string>("compliance");
  const [required, setRequired] = useState(true);
  const [legal, setLegal] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function add() {
    start(async () => {
      const result = await saveTemplate({ id: null, stage, part: stage === "onboarding" ? part : null, label, required, legal, appliesTo: "any", dueDays: null, active: true });
      setMessage(result.message ?? null);
      if (result.ok) {
        setLabel("");
        router.refresh();
      }
    });
  }

  function retire(t: TemplateRow) {
    start(async () => {
      const result = await saveTemplate({ id: t.id, stage, part: t.part, label: t.label, required: t.required, legal: t.legal, appliesTo: t.applies_to, dueDays: t.due_days, active: !t.active });
      setMessage(result.message ?? null);
      if (result.ok) router.refresh();
    });
  }

  return (
    <details className="rounded-xl border border-border bg-card p-3 text-sm">
      <summary className="cursor-pointer font-medium">{STAGE_LABEL[stage]} <span className="font-normal text-muted-foreground">({items.filter((i) => i.active).length})</span></summary>
      <ul className="mt-2 space-y-1">
        {items.map((t) => (
          <li key={t.id} className={`flex items-start gap-2 ${t.active ? "" : "text-muted-foreground line-through"}`}>
            <span className="flex-1">
              {t.part ? <span className="text-xs text-muted-foreground">{ONBOARDING_PARTS[t.part as keyof typeof ONBOARDING_PARTS]}: </span> : null}
              {t.label}
              {t.legal && <span className="ml-1 rounded bg-sky-100 px-1 text-xs font-semibold text-sky-900">Legal</span>}
              {!t.required && <span className="ml-1 text-xs text-muted-foreground">Optional</span>}
            </span>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => retire(t)}>{t.active ? "Remove" : "Restore"}</Button>
          </li>
        ))}
      </ul>
      <div className="mt-3 grid gap-2 border-t border-border pt-3">
        <Input aria-label={`New ${STAGE_LABEL[stage]} item`} placeholder="New checklist item" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className="flex flex-wrap items-center gap-3">
          {stage === "onboarding" && (
            <select aria-label="Onboarding part" className="h-9 rounded-md border border-border bg-background px-2" value={part} onChange={(e) => setPart(e.target.value)}>
              {Object.entries(ONBOARDING_PARTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          )}
          <label className="flex items-center gap-1"><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={legal} onChange={(e) => setLegal(e.target.checked)} /> Legal</label>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={add}>Add</Button>
        </div>
        {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      </div>
    </details>
  );
}

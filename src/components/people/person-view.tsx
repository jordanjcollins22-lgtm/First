"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, FileText, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import {
  addPerformanceRecord,
  advancePerson,
  assignModule,
  attachItemDocument,
  finishOffboarding,
  personDocumentUrl,
  recordOfferResponse,
  returnToTraining,
  saveEvaluation,
  saveOffer,
  saveScorecard,
  sendOffer,
  setItemDone,
  setPersonOwner,
  setTrainingStep,
  startAdvancement,
  startOffboarding,
  startPersonUpload,
  type PeopleResult,
} from "@/lib/actions/people-actions";
import type { AssignmentRow, ItemRow, OfferRow, PersonDetail } from "@/lib/data/people";
import {
  EVALUATION_OUTCOME,
  INTERVIEW_CRITERIA,
  INTERVIEW_OUTCOME,
  ONBOARDING_PARTS,
  PERFORMANCE_KINDS,
  ROLE_LABEL,
  ROLE_PATH,
  STAGE_KEYS,
  STAGE_LABEL,
  assignmentEligibility,
} from "@/lib/people/lifecycle";

type Say = (r: PeopleResult) => void;

function useAct() {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<PeopleResult>, after?: Say) =>
    start(async () => {
      const result = await fn();
      setMessage(result.message ? { ok: result.ok, text: result.message } : result.ok ? null : { ok: false, text: "Couldn't save that." });
      after?.(result);
      if (result.ok) router.refresh();
    });
  const status = message && <p role="status" className={`text-sm ${message.ok ? "text-emerald-700" : "text-destructive"}`}>{message.text}</p>;
  return { busy, run, status };
}

function roleName(key: string | null): string {
  return key && key in ROLE_LABEL ? ROLE_LABEL[key as keyof typeof ROLE_LABEL] : "Position not set";
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

function Card({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function PersonView({ detail }: { detail: PersonDetail }) {
  const { person } = detail;
  const eligibility = assignmentEligibility(person.stage, person.status);
  const currentItems = detail.items.filter((i) => i.stage === person.stage);
  const preHire = ["application", "screening", "interview", "job_offer"].includes(person.stage);
  const stagePath = STAGE_KEYS.filter((s) => s !== "offboarding" && s !== "advancement");
  const at = stagePath.indexOf(person.stage as (typeof stagePath)[number]);
  const hired = !preHire && person.status === "active";

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <Link href="/admin/people" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" aria-hidden /> People</Link>

      <header className="space-y-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{roleName(person.position)}{person.classification !== "undetermined" ? ` · ${person.classification}` : ""}</p>
        <h1 className="text-2xl font-bold">{person.full_name}</h1>
        <p className="text-sm">
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{STAGE_LABEL[person.stage]}</span>
          {person.status !== "active" && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold capitalize">{person.status}</span>}
          <span className="ml-2 text-muted-foreground">Assignments: {eligibility.level === "unsupervised" ? "Unsupervised" : eligibility.level === "supervised" ? "Supervised only" : "Not eligible"}</span>
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          {person.phone && <a className="text-primary hover:underline" href={`tel:${person.phone}`}>{person.phone}</a>}
          {person.email && <a className="text-primary hover:underline" href={`mailto:${person.email}`}>{person.email}</a>}
          {detail.applicants.map((a) => <Link key={a.id} className="text-primary hover:underline" href={`/admin/hiring/${a.id}`}>Application: {roleName(a.position)}</Link>)}
        </div>
      </header>

      <ol aria-label="Lifecycle" className="flex gap-1 overflow-x-auto pb-1 text-xs">
        {stagePath.map((s, i) => (
          <li key={s} aria-current={s === person.stage ? "step" : undefined} className={`shrink-0 rounded-full px-2 py-1 ${s === person.stage ? "bg-primary font-semibold text-primary-foreground" : at > i ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{STAGE_LABEL[s]}</li>
        ))}
      </ol>

      <NextStep detail={detail} />
      {currentItems.length > 0 && <Checklist detail={detail} items={currentItems} />}
      {person.stage === "interview" && person.status === "active" && <ScorecardForm personId={person.id} />}
      {detail.scorecards.length > 0 && <Scorecards detail={detail} />}
      {(person.stage === "job_offer" || detail.offers.length > 0) && <Offers detail={detail} />}
      {(detail.assignments.length > 0 || hired) && <Training detail={detail} />}
      {(hired || detail.evaluations.length > 0) && <Evaluations detail={detail} />}
      {(detail.competencies.length > 0 || hired) && <Competencies detail={detail} />}
      {(hired || detail.performance.length > 0) && <Performance detail={detail} />}
      {hired && <Changes detail={detail} />}
      <History detail={detail} />
    </div>
  );
}

function NextStep({ detail }: { detail: PersonDetail }) {
  const { person, next, missing } = detail;
  const { busy, run, status } = useAct();
  return (
    <Card title="Next action">
      <p className="text-sm font-medium">{detail.nextAction}</p>
      <label className="grid gap-1 text-sm font-medium sm:max-w-xs">
        Assigned owner
        <select className="h-10 rounded-md border border-border bg-background px-2" value={person.owner_id ?? ""} disabled={busy} onChange={(e) => run(() => setPersonOwner({ id: person.id, ownerId: e.target.value || null }))}>
          <option value="">Unassigned</option>
          {detail.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      {next && person.status === "active" && (
        <div className="space-y-2 border-t border-border pt-3">
          {missing.length > 0 && (
            <div>
              <p className="text-sm font-medium">Missing before {STAGE_LABEL[next]}</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-muted-foreground">{missing.slice(0, 8).map((m) => <li key={m}>{m}</li>)}{missing.length > 8 && <li>and {missing.length - 8} more</li>}</ul>
            </div>
          )}
          <Button type="button" disabled={busy || missing.length > 0} onClick={() => run(() => advancePerson({ id: person.id }))}>Move to {STAGE_LABEL[next]}</Button>
        </div>
      )}
      {person.stage === "onboarding" && !person.profile_id && <Link href="/admin/team" className="block text-sm font-medium text-primary hover:underline">Add their app account on Team</Link>}
      {person.stage === "offboarding" && person.status === "active" && <Button type="button" disabled={busy} onClick={() => run(() => finishOffboarding({ personId: person.id }))}>Finish offboarding</Button>}
      {status}
    </Card>
  );
}

function Checklist({ detail, items }: { detail: PersonDetail; items: ItemRow[] }) {
  const parts = detail.person.stage === "onboarding" ? (Object.keys(ONBOARDING_PARTS) as (keyof typeof ONBOARDING_PARTS)[]) : [null];
  return (
    <Card title={`${STAGE_LABEL[detail.person.stage]} checklist`}>
      {parts.map((part) => {
        const group = part ? items.filter((i) => i.part === part) : items;
        if (!group.length) return null;
        return (
          <div key={part ?? "all"} className="space-y-1">
            {part && <h3 className="text-sm font-semibold">{ONBOARDING_PARTS[part]}</h3>}
            <ul className="divide-y divide-border rounded-lg border border-border">{group.map((i) => <ChecklistItem key={i.id} personId={detail.person.id} item={i} />)}</ul>
          </div>
        );
      })}
    </Card>
  );
}

function ChecklistItem({ personId, item }: { personId: string; item: ItemRow }) {
  const { busy, run, status } = useAct();
  const input = useRef<HTMLInputElement>(null);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = !item.done_at && item.due_on && item.due_on < today;

  async function upload(file: File) {
    run(async () => {
      const slot = await startPersonUpload({ personId, fileName: file.name });
      if (!slot.ok) return slot;
      const { error } = await createClient().storage.from("people-docs").uploadToSignedUrl(slot.path, slot.uploadToken, file);
      if (error) return { ok: false, message: "That upload didn't finish. Try again." };
      return attachItemDocument({ personId, itemId: item.id, path: slot.path });
    });
  }

  async function openFile() {
    if (!item.document_path) return;
    const opened = await personDocumentUrl({ personId, path: item.document_path });
    if (opened.ok) window.open(opened.url, "_blank", "noopener");
  }

  return (
    <li className="space-y-1 p-2 text-sm">
      <div className="flex items-start gap-2">
        <label className="flex flex-1 items-start gap-2">
          <input type="checkbox" className="mt-1 h-4 w-4" checked={Boolean(item.done_at)} disabled={busy} onChange={(e) => run(() => setItemDone({ personId, itemId: item.id, done: e.target.checked }))} />
          <span>
            {item.label}
            {item.legal && <span className="ml-1 rounded bg-sky-100 px-1 text-xs font-semibold text-sky-900">Legal</span>}
            {!item.required && <span className="ml-1 text-xs text-muted-foreground">Optional</span>}
            <span className={`block text-xs ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
              {item.done_at ? `Done ${when(item.done_at)}${item.done_by_name ? ` by ${item.done_by_name}` : ""}` : item.due_on ? `${overdue ? "Overdue, due" : "Due"} ${when(`${item.due_on}T12:00:00`)}` : ""}
            </span>
          </span>
        </label>
        {item.document_path && <Button type="button" size="sm" variant="ghost" aria-label={`Open file for ${item.label}`} onClick={openFile}><FileText className="h-4 w-4" aria-hidden /></Button>}
        <Button type="button" size="sm" variant="ghost" aria-label={`Upload file for ${item.label}`} disabled={busy} onClick={() => input.current?.click()}><Upload className="h-4 w-4" aria-hidden /></Button>
        <input ref={input} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
      </div>
      {status}
    </li>
  );
}

function ScorecardForm({ personId }: { personId: string }) {
  const { busy, run, status } = useAct();
  const [scores, setScores] = useState<Record<string, { score: number; note: string }>>({});
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  return (
    <Card title="Interview scorecard">
      <p className="text-xs text-muted-foreground">Score each area from 1 (weak) to 5 (strong) and note their response.</p>
      {INTERVIEW_CRITERIA.map((c) => (
        <fieldset key={c} className="space-y-1 border-b border-border pb-3">
          <legend className="text-sm font-medium">{c}</legend>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" aria-pressed={scores[c]?.score === n} aria-label={`${c}: ${n}`} className={`h-9 w-9 rounded-md border text-sm ${scores[c]?.score === n ? "border-primary bg-primary text-primary-foreground" : "border-border"}`} onClick={() => setScores({ ...scores, [c]: { score: n, note: scores[c]?.note ?? "" } })}>{n}</button>
            ))}
          </div>
          <Input aria-label={`${c} notes`} placeholder="Their response" value={scores[c]?.note ?? ""} onChange={(e) => setScores({ ...scores, [c]: { score: scores[c]?.score ?? 0, note: e.target.value } })} />
        </fieldset>
      ))}
      <Textarea aria-label="Overall notes" rows={3} placeholder="Overall notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Outcome">
        {Object.entries(INTERVIEW_OUTCOME).map(([k, v]) => (
          <Button key={k} type="button" role="radio" aria-checked={outcome === k} variant={outcome === k ? "default" : "outline"} onClick={() => setOutcome(k)}>{v}</Button>
        ))}
      </div>
      <Button type="button" className="w-full" disabled={busy || !outcome} onClick={() => run(() => saveScorecard({ personId, scores, notes, outcome }))}>Save scorecard</Button>
      {status}
    </Card>
  );
}

function Scorecards({ detail }: { detail: PersonDetail }) {
  return (
    <Card title="Interview records">
      {detail.scorecards.map((s) => (
        <details key={s.id} className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{INTERVIEW_OUTCOME[s.outcome]} · {when(s.created_at)}{s.interviewer_name ? ` · ${s.interviewer_name}` : ""}</summary>
          <ul className="mt-2 space-y-1">{Object.entries(s.scores).map(([k, v]) => <li key={k}><span className="font-medium">{k}: {v.score}/5</span>{v.note ? ` · ${v.note}` : ""}</li>)}</ul>
          {s.notes && <p className="mt-2 text-muted-foreground">{s.notes}</p>}
        </details>
      ))}
    </Card>
  );
}

function offerText(p: { name: string; o: OfferRow }): { subject: string; body: string } {
  const first = p.name.split(/\s+/)[0];
  return {
    subject: `Job offer: ${roleName(p.o.position)}`,
    body: `Hi ${first},\n\nWe'd like to offer you the ${roleName(p.o.position)} position.\n\nCompensation: ${p.o.compensation}\nClassification: ${p.o.classification === "employee" ? "Employee" : "Independent contractor"}\nExpected schedule: ${p.o.schedule}\nResponsibilities: ${p.o.responsibilities}\nTransportation and equipment: ${p.o.transportation}\nProposed start date: ${p.o.start_date}${p.o.agreements ? `\nApplicable agreements: ${p.o.agreements}` : ""}\n\nPlease reply to let us know whether you accept.\n\nThanks`,
  };
}

function Offers({ detail }: { detail: PersonDetail }) {
  const { person } = detail;
  const { busy, run, status } = useAct();
  const draft = detail.offers.find((o) => o.status === "draft") ?? null;
  const sent = detail.offers.find((o) => o.status === "sent") ?? null;
  const [f, setF] = useState({
    position: draft?.position ?? person.position ?? "",
    compensation: draft?.compensation ?? "",
    classification: draft?.classification ?? (person.classification === "undetermined" ? "" : person.classification),
    schedule: draft?.schedule ?? "",
    responsibilities: draft?.responsibilities ?? "",
    transportation: draft?.transportation ?? "",
    startDate: draft?.start_date ?? "",
    agreements: draft?.agreements ?? "",
  });
  const [mail, setMail] = useState<{ subject: string; body: string } | null>(null);
  const open = person.stage === "job_offer" && person.status === "active";
  return (
    <Card title="Job offer">
      {open && !sent && (
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium">Position<select className="h-10 rounded-md border border-border bg-background px-2" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })}><option value="">Choose</option>{ROLE_PATH.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-medium">Compensation<Textarea rows={2} value={f.compensation} onChange={(e) => setF({ ...f, compensation: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-medium">Employment classification
            <span className="text-xs font-normal text-muted-foreground">Decide from the actual working relationship and applicable law, not the payment method or contract label.</span>
            <select className="h-10 rounded-md border border-border bg-background px-2" value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value })}><option value="">Choose</option><option value="employee">Employee</option><option value="contractor">Independent contractor</option></select></label>
          <label className="grid gap-1 text-sm font-medium">Expected schedule<Input value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-medium">Responsibilities<Textarea rows={3} value={f.responsibilities} onChange={(e) => setF({ ...f, responsibilities: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-medium">Transportation and equipment requirements<Textarea rows={2} value={f.transportation} onChange={(e) => setF({ ...f, transportation: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-medium">Proposed start date<Input type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></label>
          <label className="grid gap-1 text-sm font-medium">Applicable agreements<Input value={f.agreements} onChange={(e) => setF({ ...f, agreements: e.target.value })} /></label>
          <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => saveOffer({ personId: person.id, ...f }))}>Save offer</Button>
          {draft && !mail && <Button type="button" disabled={busy} onClick={() => setMail(offerText({ name: person.full_name, o: draft }))}>Preview offer email</Button>}
          {draft && mail && (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs text-muted-foreground">Change anything you like. Nothing is sent until you press Send.</p>
              <Input aria-label="Subject" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
              <Textarea aria-label="Email" rows={12} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} />
              <Button type="button" className="w-full" disabled={busy} onClick={() => run(() => sendOffer({ personId: person.id, offerId: draft.id, ...mail }))}>Send offer</Button>
            </div>
          )}
        </div>
      )}
      {sent && open && (
        <div className="flex flex-wrap gap-2">
          <p className="w-full text-sm">Offer sent {when(sent.sent_at)}. Record their answer.</p>
          <Button type="button" disabled={busy} onClick={() => run(() => recordOfferResponse({ personId: person.id, offerId: sent.id, response: "accepted" }))}>Accepted</Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => run(() => recordOfferResponse({ personId: person.id, offerId: sent.id, response: "declined" }))}>Declined</Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={() => run(() => recordOfferResponse({ personId: person.id, offerId: sent.id, response: "withdrawn" }))}>Withdrawn</Button>
        </div>
      )}
      {detail.offers.filter((o) => o.status !== "draft").map((o) => (
        <p key={o.id} className="text-sm text-muted-foreground"><span className="capitalize">{o.status}</span> · {roleName(o.position)} · starts {when(`${o.start_date}T12:00:00`)} · {o.compensation}</p>
      ))}
      {status}
    </Card>
  );
}

const STEPS: { key: "read_at" | "shown_at" | "showed_back_at" | "taught_at"; label: string; field: keyof AssignmentRow }[] = [
  { key: "read_at", label: "Read the written training", field: "read_at" },
  { key: "shown_at", label: "We showed them", field: "shown_at" },
  { key: "showed_back_at", label: "They showed us without correction", field: "showed_back_at" },
  { key: "taught_at", label: "They taught someone else", field: "taught_at" },
];

function Training({ detail }: { detail: PersonDetail }) {
  const { person } = detail;
  const { busy, run, status } = useAct();
  const [choice, setChoice] = useState("");
  return (
    <Card title="Training">
      {detail.assignments.length === 0 && <p className="text-sm text-muted-foreground">No modules assigned. People get the published modules for their position when they reach Training.</p>}
      {detail.assignments.map((a) => (
        <details key={a.id} className="rounded-lg border border-border p-3 text-sm">
          <summary className="cursor-pointer font-medium">{a.title} <span className="font-normal text-muted-foreground">({STEPS.filter((s) => a[s.field]).length}/4)</span></summary>
          <ul className="mt-2 space-y-1">
            {STEPS.map((s) => (
              <li key={s.key}><label className="flex items-center gap-2"><input type="checkbox" className="h-4 w-4" disabled={busy} checked={Boolean(a[s.field])} onChange={(e) => run(() => setTrainingStep({ personId: person.id, assignmentId: a.id, step: s.key, done: e.target.checked }))} /> {s.label}</label></li>
            ))}
          </ul>
          {a.module && (
            <div className="mt-3 space-y-2 border-t border-border pt-2">
              <p><span className="font-medium">Purpose:</span> {a.module.purpose}</p>
              <ModuleList title="Materials" list={a.module.materials} />
              <ModuleList title="Safety" list={a.module.safety} />
              <ModuleList title="Procedure" list={a.module.steps} ordered />
              <ModuleList title="Quality standards" list={a.module.standards} />
              <ModuleList title="Common mistakes" list={a.module.mistakes} />
              {a.module.demo_url && <a href={a.module.demo_url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">Open demonstration</a>}
              <p><span className="font-medium">Practice:</span> {a.module.practice}</p>
            </div>
          )}
        </details>
      ))}
      {detail.availableModules.length > 0 && (
        <div className="flex gap-2">
          <select aria-label="Assign a module" className="h-10 flex-1 rounded-md border border-border bg-background px-2 text-sm" value={choice} onChange={(e) => setChoice(e.target.value)}><option value="">Assign another module</option>{detail.availableModules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
          <Button type="button" variant="outline" disabled={busy || !choice} onClick={() => run(() => assignModule({ personId: person.id, moduleId: choice }), () => setChoice(""))}>Assign</Button>
        </div>
      )}
      {status}
    </Card>
  );
}

function ModuleList({ title, list, ordered }: { title: string; list: string[]; ordered?: boolean }) {
  if (!list.length) return null;
  const items = list.map((l) => <li key={l}>{l}</li>);
  return <div><p className="font-medium">{title}</p>{ordered ? <ol className="list-decimal pl-5">{items}</ol> : <ul className="list-disc pl-5">{items}</ul>}</div>;
}

function Evaluations({ detail }: { detail: PersonDetail }) {
  const { person } = detail;
  const { busy, run, status } = useAct();
  const [moduleId, setModuleId] = useState("");
  const [subject, setSubject] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [met, setMet] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState("");
  const [corrective, setCorrective] = useState("");
  const [outcome, setOutcome] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const addFile = (file: File) =>
    run(async () => {
      const slot = await startPersonUpload({ personId: person.id, fileName: file.name });
      if (!slot.ok) return slot;
      const { error } = await createClient().storage.from("people-docs").uploadToSignedUrl(slot.path, slot.uploadToken, file);
      if (error) return { ok: false, message: "That upload didn't finish. Try again." };
      setFiles((list) => [...list, slot.path]);
      return { ok: true, message: "File added. It's saved with this evaluation." };
    });
  const openFile = async (path: string) => {
    const opened = await personDocumentUrl({ personId: person.id, path });
    if (opened.ok) window.open(opened.url, "_blank", "noopener");
  };
  const mod = detail.assignments.find((a) => a.module_id === moduleId)?.module ?? null;
  const results = (mod?.criteria ?? []).map((criterion) => ({ criterion, met: Boolean(met[criterion]) }));
  const canEvaluate = person.status === "active";

  return (
    <Card title="Evaluations">
      {canEvaluate && (
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium">Skill or responsibility
            <select className="h-10 rounded-md border border-border bg-background px-2" value={moduleId} onChange={(e) => { setModuleId(e.target.value); setMet({}); }}>
              <option value="">Other (write it below)</option>
              {detail.assignments.map((a) => <option key={a.module_id} value={a.module_id}>{a.title}</option>)}
            </select>
          </label>
          {!moduleId && <Input aria-label="What's being evaluated" placeholder="What's being evaluated" value={subject} onChange={(e) => setSubject(e.target.value)} />}
          <label className="grid gap-1 text-sm font-medium">Date<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {results.length > 0 && (
            <fieldset className="space-y-1 text-sm"><legend className="font-medium">Criteria met</legend>
              {results.map((r) => <label key={r.criterion} className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={r.met} onChange={(e) => setMet({ ...met, [r.criterion]: e.target.checked })} /> {r.criterion}</label>)}
            </fieldset>
          )}
          <Textarea aria-label="Supporting notes" rows={2} placeholder="Supporting notes from observed work" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileInput.current?.click()}><Upload className="mr-1 h-4 w-4" aria-hidden /> Add a photo or file{files.length ? ` (${files.length})` : ""}</Button>
            <input ref={fileInput} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && addFile(e.target.files[0])} />
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Final decision">
            {Object.entries(EVALUATION_OUTCOME).map(([k, v]) => <Button key={k} type="button" role="radio" aria-checked={outcome === k} variant={outcome === k ? "default" : "outline"} onClick={() => setOutcome(k)}>{v}</Button>)}
          </div>
          {outcome && outcome !== "pass" && <Textarea aria-label="Required corrective actions" rows={2} placeholder="Required corrective actions" value={corrective} onChange={(e) => setCorrective(e.target.value)} />}
          <Button type="button" disabled={busy || !outcome} onClick={() => run(() => saveEvaluation({ personId: person.id, moduleId: moduleId || null, subject, date, results, notes, corrective, outcome, documentPaths: files }), (r) => { if (r.ok) { setOutcome(""); setNotes(""); setCorrective(""); setMet({}); setFiles([]); } })}>Save evaluation</Button>
        </div>
      )}
      {detail.evaluations.map((e) => (
        <div key={e.id} className="space-y-1 rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">{e.subject}: {EVALUATION_OUTCOME[e.outcome]}</p>
          <p className="text-xs text-muted-foreground">{when(`${e.evaluated_on}T12:00:00`)}{e.evaluator_name ? ` · ${e.evaluator_name}` : ""}</p>
          {e.results.length > 0 && <ul className="space-y-0.5">{e.results.map((r) => <li key={r.criterion} className={r.met ? "" : "text-destructive"}>{r.met ? "Met" : "Not met"}: {r.criterion}</li>)}</ul>}
          {e.notes && <p>{e.notes}</p>}
          {e.corrective_actions && <p><span className="font-medium">Corrective actions:</span> {e.corrective_actions}</p>}
          {e.document_paths.map((path, i) => <Button key={path} type="button" size="sm" variant="ghost" onClick={() => openFile(path)}><FileText className="mr-1 h-4 w-4" aria-hidden /> File {i + 1}</Button>)}
          {e.outcome !== "pass" && e.module_id && canEvaluate && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => returnToTraining({ personId: person.id, moduleId: e.module_id as string }))}>Return to training</Button>}
        </div>
      ))}
      {status}
    </Card>
  );
}

function Competencies({ detail }: { detail: PersonDetail }) {
  const list = detail.competencies.filter((c) => !c.revoked_at);
  return (
    <Card title="Verified competencies">
      {list.length === 0 ? <p className="text-sm text-muted-foreground">None verified yet. A competency is verified by passing its evaluation.</p> : (
        <ul className="space-y-1 text-sm">{list.map((c) => <li key={c.competency_key} className="flex items-center gap-2"><Check className="h-4 w-4 text-emerald-700" aria-hidden />{c.label} <span className="text-xs text-muted-foreground">{when(c.verified_at)}{c.verified_by_name ? ` · ${c.verified_by_name}` : ""}</span></li>)}</ul>
      )}
    </Card>
  );
}

function Performance({ detail }: { detail: PersonDetail }) {
  const { person } = detail;
  const { busy, run, status } = useAct();
  const [kind, setKind] = useState("quality");
  const [result, setResult] = useState("note");
  const [note, setNote] = useState("");
  return (
    <Card title="Performance record">
      {person.status === "active" && (
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <select aria-label="Measurement" className="h-10 rounded-md border border-border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(PERFORMANCE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <select aria-label="Result" className="h-10 rounded-md border border-border bg-background px-2 text-sm" value={result} onChange={(e) => setResult(e.target.value)}><option value="note">Note</option><option value="good">Good</option><option value="needs_work">Needs work</option></select>
          </div>
          <Textarea aria-label="What happened" rows={2} placeholder="What happened" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="button" variant="outline" disabled={busy || !note.trim()} onClick={() => run(() => addPerformanceRecord({ personId: person.id, kind, result, note }), (r) => { if (r.ok) setNote(""); })}>Add to record</Button>
        </div>
      )}
      <ul className="space-y-2 text-sm">
        {detail.performance.map((p) => <li key={p.id} className="border-t border-border pt-2"><span className="font-medium">{PERFORMANCE_KINDS[p.kind as keyof typeof PERFORMANCE_KINDS] ?? p.kind}</span> <span className={p.result === "needs_work" ? "text-destructive" : "text-muted-foreground"}>{p.result === "needs_work" ? "Needs work" : p.result === "good" ? "Good" : ""}</span><p>{p.note}</p><p className="text-xs text-muted-foreground">{when(p.created_at)}{p.author_name ? ` · ${p.author_name}` : ""}</p></li>)}
      </ul>
      {status}
    </Card>
  );
}

function Changes({ detail }: { detail: PersonDetail }) {
  const { person } = detail;
  const { busy, run, status } = useAct();
  const [role, setRole] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const canAdvance = person.stage === "deployment" || person.stage === "performance_management";
  return (
    <Card title="Advancement or offboarding">
      {canAdvance && (
        <div className="grid gap-2">
          <p className="text-xs text-muted-foreground">Based on documented qualifications, performance, competency and business need. Roles aren&apos;t always one straight path.</p>
          <select aria-label="New role" className="h-10 rounded-md border border-border bg-background px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value)}><option value="">Choose a role</option>{ROLE_PATH.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
          <Textarea aria-label="Qualifications" rows={2} placeholder="Qualifications behind this move" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button type="button" variant="outline" disabled={busy || !role} onClick={() => run(() => startAdvancement({ personId: person.id, role, note }))}>Start advancement</Button>
        </div>
      )}
      {person.stage !== "offboarding" && (
        <div className="grid gap-2 border-t border-border pt-3">
          <Textarea aria-label="Offboarding reason" rows={2} placeholder="Reason, if ending this relationship" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button type="button" variant="ghost" disabled={busy || !reason.trim()} onClick={() => run(() => startOffboarding({ personId: person.id, reason }))}>Start offboarding</Button>
        </div>
      )}
      {status}
    </Card>
  );
}

const EVENT: Record<string, string> = {
  applied: "Applied", record_created: "Record created", stage_changed: "Stage changed", owner_changed: "Owner changed", item_done: "Checklist item completed", item_reopened: "Checklist item reopened",
  scorecard: "Interview scorecard saved", offer_saved: "Offer saved", offer_sent: "Offer sent", offer_accepted: "Offer accepted", offer_declined: "Offer declined", offer_withdrawn: "Offer withdrawn",
  training_step: "Training updated", module_assigned: "Module assigned", evaluation: "Evaluation saved", corrective_training: "Returned to training", performance: "Performance record added",
  advancement: "Advancement started", offboarding_started: "Offboarding started", offboarded: "Offboarded", document_added: "File added", account_linked: "App account linked",
};

function History({ detail }: { detail: PersonDetail }) {
  return (
    <Card title="History">
      <ol className="space-y-1 text-sm">
        {detail.events.map((e, i) => {
          const to = e.detail?.to;
          const label = e.detail?.label;
          return (
            <li key={i} className="flex gap-2">
              <span className="w-24 shrink-0 text-muted-foreground">{when(e.at)}</span>
              <span>{EVENT[e.kind] ?? e.kind}{typeof to === "string" && to in STAGE_LABEL ? ` to ${STAGE_LABEL[to as keyof typeof STAGE_LABEL]}` : ""}{typeof label === "string" ? `: ${label}` : ""}{e.actor_name ? ` by ${e.actor_name}` : ""}</span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

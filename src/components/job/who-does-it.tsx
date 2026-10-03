"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, HardHat, Loader2, Mail, MessageSquare, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assignVisit, createSubcontractor } from "@/lib/actions/subcontractor-actions";
import { cn } from "@/lib/utils";

export interface SubcontractorOption {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  usesOurTools: boolean;
}

export interface VisitChoice {
  id: string;
  startsOn: string;
  endsOn: string;
  subcontractorId: string | null;
  crewToken: string | null;
}

const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

/**
 * Who does each visit of a signed job: our crew, or a subcontractor. A
 * subcontractor gets their own crew sheet by link, to text or email them;
 * one that uses our tools picks them up at the shop first.
 */
export function WhoDoesIt({
  visits,
  subcontractors,
  baseUrl,
  preview = false,
}: {
  visits: VisitChoice[];
  subcontractors: SubcontractorOption[];
  baseUrl: string;
  preview?: boolean;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <HardHat className="h-5 w-5 text-primary" />
        <h2 className="text-base font-semibold">Who does it</h2>
      </div>
      {visits.map((visit) => (
        <VisitRow key={visit.id} visit={visit} subcontractors={subcontractors} baseUrl={baseUrl} preview={preview} />
      ))}
    </section>
  );
}

function VisitRow({ visit, subcontractors, baseUrl, preview }: { visit: VisitChoice; subcontractors: SubcontractorOption[]; baseUrl: string; preview: boolean }) {
  const router = useRouter();
  const [subs, setSubs] = useState(subcontractors);
  const [chosen, setChosen] = useState<string | null>(visit.subcontractorId);
  const [token, setToken] = useState<string | null>(visit.crewToken);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", usesOurTools: false });
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const sub = subs.find((s) => s.id === chosen) ?? null;
  const link = token ? `${baseUrl}/crew/${token}` : null;
  const when = visit.startsOn === visit.endsOn ? day(visit.startsOn) : `${day(visit.startsOn)} to ${day(visit.endsOn)}`;

  function pick(id: string | null) {
    setError(null);
    if (preview) {
      setChosen(id);
      if (id && !token) setToken("sample");
      return;
    }
    start(async () => {
      const result = await assignVisit(visit.id, id);
      if (!result.ok) return setError(result.message);
      setChosen(id);
      setToken(result.token ?? token);
      router.refresh();
    });
  }

  function add() {
    setError(null);
    if (!form.name.trim()) return setError("Give them a name.");
    if (preview) {
      const id = `sample-${subs.length}`;
      setSubs([...subs, { id, name: form.name, phone: form.phone || null, email: form.email || null, usesOurTools: form.usesOurTools }]);
      setAdding(false);
      return pick(id);
    }
    start(async () => {
      const made = await createSubcontractor({ name: form.name, phone: form.phone, email: form.email, usesOurTools: form.usesOurTools });
      if (!made.ok) return setError(made.message);
      setSubs([...subs, { id: made.id, name: form.name.trim(), phone: form.phone || null, email: form.email || null, usesOurTools: form.usesOurTools }]);
      setAdding(false);
      const result = await assignVisit(visit.id, made.id);
      if (!result.ok) return setError(result.message);
      setChosen(made.id);
      setToken(result.token);
      router.refresh();
    });
  }

  const chip = (on: boolean) =>
    cn("min-h-10 rounded-full border px-3 text-sm", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background");

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3">
      <p className="text-sm font-semibold">{when}</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={chip(chosen === null)} disabled={pending} onClick={() => pick(null)}>
          Our crew
        </button>
        {subs.map((s) => (
          <button key={s.id} type="button" className={chip(chosen === s.id)} disabled={pending} onClick={() => pick(s.id)}>
            {s.name}
          </button>
        ))}
        <button type="button" className={cn(chip(false), "flex items-center gap-1")} onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Subcontractor
        </button>
        {pending && <Loader2 className="h-5 w-5 animate-spin self-center text-muted-foreground" />}
      </div>

      {adding && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Company or name" />
          <div className="grid grid-cols-2 gap-2">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" inputMode="tel" />
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" inputMode="email" />
          </div>
          <p className="text-sm font-medium">Do they use our tools?</p>
          <div className="flex gap-1.5">
            <button type="button" className={chip(form.usesOurTools)} onClick={() => setForm({ ...form, usesOurTools: true })}>
              Yes, they pick up at the shop
            </button>
            <button type="button" className={chip(!form.usesOurTools)} onClick={() => setForm({ ...form, usesOurTools: false })}>
              No, their own
            </button>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={add}>
              Add and give them this visit
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {chosen === null ? (
        <p className="text-xs text-muted-foreground">On our crew&apos;s day: the shop at the usual time, the load-out, then the job.</p>
      ) : (
        sub &&
        link && (
          <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
            <p className="text-sm">
              <span className="font-semibold">{sub.name}</span> gets their own crew sheet.{" "}
              {sub.usesOurTools ? "They pick up our kits at the shop first." : "They bring their own tools."}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(link).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                {copied ? "Copied" : "Copy their link"}
              </Button>
              {sub.phone && (
                <Button type="button" size="sm" variant="outline" asChild>
                  <a href={`sms:${sub.phone}?&body=${encodeURIComponent(`Your crew sheet for ${when}: ${link}`)}`}>
                    <MessageSquare className="mr-1 h-4 w-4" /> Text it
                  </a>
                </Button>
              )}
              {sub.email && (
                <Button type="button" size="sm" variant="outline" asChild>
                  <a href={`mailto:${sub.email}?subject=${encodeURIComponent(`Crew sheet for ${when}`)}&body=${encodeURIComponent(link)}`}>
                    <Mail className="mr-1 h-4 w-4" /> Email it
                  </a>
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" asChild>
                <a href={preview ? "#" : link} target="_blank" rel="noopener noreferrer">
                  Open it
                </a>
              </Button>
            </div>
          </div>
        )
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

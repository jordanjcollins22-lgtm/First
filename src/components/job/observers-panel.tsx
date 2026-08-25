"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Eye, Loader2, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addObserver, restoreObserver, revokeObserver } from "@/lib/actions/observer-actions";
import { RELATIONSHIPS, relationshipLabel, type ObserverRelationship } from "@/lib/observers";

export interface ObserverRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  relationship: string;
  token: string;
  revokedAt: string | null;
  lastViewedAt: string | null;
}

/**
 * Who else can watch this project.
 *
 * A management company, a property manager, a landlord, a spouse who is not on
 * the paperwork. Each gets a link showing how the work is going, with no
 * pricing and nothing to approve — the client made that decision and a second
 * approve button is a second place a job can be accepted by the wrong person.
 */
export function ObserversPanel({
  jobId,
  observers,
  baseUrl,
  setupNeeded,
}: {
  jobId: string;
  observers: ObserverRow[];
  baseUrl: string;
  /** Migration 0086 hasn't been run — say so rather than looking merely empty. */
  setupNeeded?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState<ObserverRelationship>("property_manager");
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const active = observers.filter((o) => !o.revokedAt);
  const revoked = observers.filter((o) => o.revokedAt);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addObserver(jobId, { name, email, phone, relationship });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setName("");
      setEmail("");
      setPhone("");
      setAdding(false);
    });
  }

  async function copy(token: string) {
    const link = `${baseUrl}/progress/${token}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Couldn't copy — long-press the link to copy it by hand.");
    }
  }

  return (
    <section className="rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Eye className="h-4 w-4" />
          Watching this project
        </h2>
        {!adding && !setupNeeded && (
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            Add someone
          </Button>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        A management company, property manager or family member who wants to follow the work. They see
        progress and photos — never the price, and nothing to approve.
      </p>

      {setupNeeded ? (
        <p className="rounded-lg border border-amber-400/60 bg-amber-50/60 p-3 text-sm">
          This needs its database migration. Run <code>supabase/migrations/0086_job_observers.sql</code> in
          Supabase, then reload.
        </p>
      ) : (
        <>
          {adding && (
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-3">
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs">What they are to this project</Label>
                <Select value={relationship} onValueChange={(v) => setRelationship(v as ObserverRelationship)}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIPS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Email</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs">Phone</Label>
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="h-9 text-sm"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Both optional — the link works either way, these are just so you know how to send it.
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={submit} disabled={isPending}>
                  {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Add
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={isPending}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {active.length === 0 && !adding && (
            <p className="text-xs text-muted-foreground">Nobody else is watching this one.</p>
          )}

          <ul className="flex flex-col gap-1.5">
            {active.map((observer) => (
              <li key={observer.id} className="rounded-lg border border-border bg-background/60 p-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{observer.name}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {relationshipLabel(observer.relationship)}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {[observer.email, observer.phone].filter(Boolean).join(" · ") || "No contact details"}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {observer.lastViewedAt
                    ? `Last opened ${new Date(observer.lastViewedAt).toLocaleDateString()}`
                    : "Not opened yet"}
                </p>
                <div className="mt-1.5 flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => copy(observer.token)}>
                    {copied === observer.token ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied === observer.token ? "Copied" : "Copy link"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isPending}
                    onClick={() => startTransition(() => revokeObserver(jobId, observer.id).then(() => {}))}
                  >
                    <X className="h-3.5 w-3.5" />
                    Turn off
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {revoked.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Turned off
              </p>
              <ul className="flex flex-col gap-1.5">
                {revoked.map((observer) => (
                  <li
                    key={observer.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border p-2 text-sm text-muted-foreground"
                  >
                    <span className="truncate">
                      {observer.name} · {relationshipLabel(observer.relationship)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => startTransition(() => restoreObserver(jobId, observer.id).then(() => {}))}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Turn back on
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  );
}

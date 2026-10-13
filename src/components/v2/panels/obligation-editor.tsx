"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { saveObligation, type ObligationInput } from "@/lib/actions/back-office-actions";
import { KIND_LABEL, isInsurance, type ObligationKind, type Recurrence } from "@/lib/compliance/calendar";

/**
 * Add an obligation to the compliance calendar, or change one: its date,
 * whether the business has it at all, the policy details a COI prints,
 * and the applicator credits earned so far.
 */
export function ObligationEditor({ initial, label = "Edit" }: { initial?: ObligationInput & { id: string }; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<ObligationInput>(
    initial ?? { kind: "other", title: "", dueOn: "", recurrence: "annual", active: true }
  );
  const set = <K extends keyof ObligationInput>(k: K, v: ObligationInput[K]) => setForm((f) => ({ ...f, [k]: v }));

  if (!open) {
    return (
      <Button type="button" size="sm" variant={initial ? "ghost" : "outline"} className="min-h-11" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  const field = "h-11 w-full rounded-md border bg-background px-2 text-sm";
  return (
    <form
      className="grid w-full gap-2 rounded-xl border bg-muted/40 p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveObligation({ ...form, id: initial?.id ?? null });
          if (!r.ok) return setError(r.error);
          setOpen(false);
          router.refresh();
        });
      }}
    >
      <label className="grid gap-1 text-sm sm:col-span-2">
        What it is
        <input className={field} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Registration: F-250" />
      </label>
      <label className="grid gap-1 text-sm">
        Kind
        <select className={field} value={form.kind} onChange={(e) => set("kind", e.target.value)}>
          {(Object.keys(KIND_LABEL) as ObligationKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Due or expires
        <input type="date" className={field} value={form.dueOn ?? ""} onChange={(e) => set("dueOn", e.target.value)} />
      </label>
      <label className="grid gap-1 text-sm">
        Repeats
        <select className={field} value={form.recurrence} onChange={(e) => set("recurrence", e.target.value as Recurrence)}>
          <option value="annual">Every year</option>
          <option value="biennial">Every 2 years</option>
          <option value="quarterly">Every quarter</option>
          <option value="none">Once</option>
        </select>
      </label>
      <label className="grid gap-1 text-sm">
        Whose or which (optional)
        <input className={field} value={form.holder ?? ""} onChange={(e) => set("holder", e.target.value)} />
      </label>
      {isInsurance(form.kind) && (
        <>
          <label className="grid gap-1 text-sm">
            Carrier
            <input className={field} value={form.carrier ?? ""} onChange={(e) => set("carrier", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            Policy number
            <input className={field} value={form.policyNumber ?? ""} onChange={(e) => set("policyNumber", e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm sm:col-span-2">
            Limits
            <input className={field} value={form.coverageLimits ?? ""} onChange={(e) => set("coverageLimits", e.target.value)} placeholder="$1M each occurrence / $2M aggregate" />
          </label>
        </>
      )}
      {form.creditsRequired != null && (
        <label className="grid gap-1 text-sm">
          Credits earned (of {form.creditsRequired})
          <input type="number" min={0} className={field} value={form.creditsEarned ?? 0} onChange={(e) => set("creditsEarned", Number(e.target.value))} />
        </label>
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-5 w-5" checked={form.active ?? true} onChange={(e) => set("active", e.target.checked)} />
        The business has this
      </label>
      <label className="grid gap-1 text-sm sm:col-span-2">
        Notes
        <textarea className="min-h-20 w-full rounded-md border bg-background p-2 text-sm" value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
      </label>
      {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" className="min-h-11" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

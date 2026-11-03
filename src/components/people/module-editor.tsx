"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveModule } from "@/lib/actions/people-actions";
import type { ModuleRow } from "@/lib/data/people";
import { ROLE_LABEL, ROLE_PATH } from "@/lib/people/lifecycle";

export function ModuleEditor({ module: mod }: { module: ModuleRow | null }) {
  const router = useRouter();
  const [f, setF] = useState({
    title: mod?.title ?? "",
    purpose: mod?.purpose ?? "",
    materials: (mod?.materials ?? []).join("\n"),
    safety: (mod?.safety ?? []).join("\n"),
    steps: (mod?.steps ?? []).join("\n"),
    standards: (mod?.standards ?? []).join("\n"),
    mistakes: (mod?.mistakes ?? []).join("\n"),
    demoUrl: mod?.demo_url ?? "",
    practice: mod?.practice ?? "",
    criteria: (mod?.criteria ?? []).join("\n"),
    competencyLabel: mod?.competency_label ?? "",
    status: mod?.status ?? "draft",
    required: mod?.required ?? true,
    positions: mod?.positions ?? [],
  });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  function area(key: "materials" | "safety" | "steps" | "standards" | "mistakes" | "criteria", label: string, rows = 4) {
    return (
      <label className="grid gap-1 text-sm font-medium">
        {label}
        <span className="text-xs font-normal text-muted-foreground">One per line</span>
        <Textarea rows={rows} value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
      </label>
    );
  }

  function save() {
    start(async () => {
      const result = await saveModule({ ...f, id: mod?.id ?? null });
      setMessage({ ok: result.ok, text: result.message ?? (result.ok ? "Saved." : "Couldn't save that.") });
      if (result.ok && !mod && "id" in result && result.id) router.replace(`/admin/people/training/${result.id}`);
      else if (result.ok) router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-6">
      <Link href="/admin/people/training" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="h-4 w-4" aria-hidden /> Training library</Link>
      <h1 className="text-xl font-semibold">{mod ? "Edit training module" : "New training module"}</h1>
      <label className="grid gap-1 text-sm font-medium">1. Training title<Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="grid gap-1 text-sm font-medium">2. Purpose<Textarea rows={2} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></label>
      {area("materials", "3. Required materials or equipment")}
      {area("safety", "4. Safety considerations")}
      {area("steps", "5. Step-by-step procedure", 10)}
      {area("standards", "6. Quality standards")}
      {area("mistakes", "7. Common mistakes")}
      <label className="grid gap-1 text-sm font-medium">8. Demonstration materials<span className="text-xs font-normal text-muted-foreground">A link to a video or document, when available</span><Input type="url" placeholder="https://" value={f.demoUrl} onChange={(e) => setF({ ...f, demoUrl: e.target.value })} /></label>
      <label className="grid gap-1 text-sm font-medium">9. Practice requirements<Textarea rows={3} value={f.practice} onChange={(e) => setF({ ...f, practice: e.target.value })} /></label>
      {area("criteria", "10. Evaluation criteria", 5)}
      <label className="grid gap-1 text-sm font-medium">Competency verified by passing<Input value={f.competencyLabel} onChange={(e) => setF({ ...f, competencyLabel: e.target.value })} /></label>
      <fieldset className="space-y-1 text-sm">
        <legend className="font-medium">Positions</legend>
        <p className="text-xs text-muted-foreground">Leave all unchecked for every position.</p>
        {ROLE_PATH.map((r) => (
          <label key={r} className="flex items-center gap-2">
            <input type="checkbox" checked={f.positions.includes(r)} onChange={(e) => setF({ ...f, positions: e.target.checked ? [...f.positions, r] : f.positions.filter((p) => p !== r) })} /> {ROLE_LABEL[r]}
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.required} onChange={(e) => setF({ ...f, required: e.target.checked })} /> Required before evaluation and deployment</label>
      <label className="grid gap-1 text-sm font-medium">
        Status
        <select className="h-10 rounded-md border border-border bg-background px-2" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as typeof f.status })}>
          <option value="draft">Draft</option>
          <option value="published">Published</option>
          <option value="retired">Retired</option>
        </select>
      </label>
      <Button type="button" className="w-full" disabled={busy} onClick={save}>Save module</Button>
      {message && <p role="status" className={`text-sm ${message.ok ? "text-emerald-700" : "text-destructive"}`}>{message.text}</p>}
    </div>
  );
}

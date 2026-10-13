"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { attachDoc, createDocUpload, openDoc, saveBackOfficeSetting } from "@/lib/actions/back-office-actions";
import type { EditableSetting } from "@/lib/data/back-office-settings";

/**
 * The small interactive pieces the back-office panels share: a switch, a
 * number, a one-tap action, a document upload. Each one calls its server
 * action, says what happened in a line under it, and refreshes the page.
 */

type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

function Note({ text, bad }: { text: string | null; bad: boolean }) {
  if (!text) return null;
  return <p className={`mt-1 text-xs ${bad ? "text-destructive" : "text-muted-foreground"}`}>{text}</p>;
}

/** An on/off switch for one setting. */
export function SettingSwitch({ setting, on, label, hint }: { setting: EditableSetting; on: boolean; label: string; hint?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  return (
    <div className="flex min-h-11 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        <Note text={note?.text ?? null} bad={note?.bad ?? false} />
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await saveBackOfficeSetting(setting, !on);
            setNote(r.ok ? null : { text: r.error, bad: true });
            router.refresh();
          })
        }
        className={`relative mt-1 inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${on ? "bg-primary" : "bg-muted-foreground/30"} disabled:opacity-60`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
      </button>
    </div>
  );
}

/** A number setting, saved on blur or Enter. */
export function SettingNumber({ setting, value, label, suffix }: { setting: EditableSetting; value: number; label: string; suffix?: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState(String(value));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const n = Number(draft);
    if (n === value || draft.trim() === "") return;
    start(async () => {
      const r = await saveBackOfficeSetting(setting, n);
      setError(r.ok ? null : r.error);
      router.refresh();
    });
  };
  return (
    <label className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <span className="flex items-center gap-1">
        <input
          inputMode="decimal"
          value={draft}
          disabled={pending}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          className="h-11 w-20 rounded-md border bg-background px-2 text-right"
        />
        {suffix && <span className="text-muted-foreground">{suffix}</span>}
      </span>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

/** One tap that runs a server action. */
export function ActionButton({
  run,
  children,
  variant = "outline",
  confirm,
}: {
  run: () => Promise<ActionResult>;
  children: ReactNode;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive";
  confirm?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button
        type="button"
        size="sm"
        variant={variant}
        className="min-h-11"
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await run();
            setNote(r.ok ? (r.message ? { text: r.message, bad: false } : null) : { text: r.error, bad: true });
            router.refresh();
          });
        }}
      >
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </Button>
      <Note text={note?.text ?? null} bad={note?.bad ?? false} />
    </span>
  );
}

/** Upload a PDF or photo against an obligation or a checklist item, straight to private storage. */
export function DocUpload({ area, id, label = "Upload" }: { area: "obligation" | "onboarding"; id: string; label?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const slot = await createDocUpload({ area, id, fileType: file.type, fileSize: file.size });
      if (!slot.ok) return setError(slot.error);
      const sent = await createClient().storage.from(slot.bucket).uploadToSignedUrl(slot.path, slot.token, file, { contentType: file.type });
      if (sent.error) return setError("That file wouldn't upload. Try again.");
      const saved = await attachDoc({ area, id, path: slot.path });
      if (!saved.ok) return setError(saved.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col">
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = "";
        }}
      />
      <Button type="button" size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        {label}
      </Button>
      <Note text={error} bad />
    </span>
  );
}

/** Open a stored document in a new tab, through a short-lived link. */
export function OpenDoc({ area, id, label = "View" }: { area: "obligation" | "onboarding"; id: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="min-h-11"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await openDoc({ area, id });
          setBusy(false);
          if (r.ok) window.open(r.url, "_blank", "noopener");
          else setError(r.error);
        }}
      >
        {label}
      </Button>
      <Note text={error} bad />
    </span>
  );
}

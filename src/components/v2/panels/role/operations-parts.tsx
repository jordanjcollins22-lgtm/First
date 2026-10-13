"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ClipboardCheck, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { leadRequestWalkthrough, leadSignOff } from "@/lib/actions/project-lead-home-actions";
import type { WalkthroughStatus } from "@/types/domain";

/**
 * Today's job sheets, one open at a time.
 *
 * The stop they are on (or heading to) starts open. The "Job sheet" links on
 * the day card above point here: tapping one opens that stop's sheet and
 * scrolls to it, so the whole job is worked without leaving this screen.
 */
export function StopSheets({
  items,
  openId,
}: {
  items: { jobId: string; title: string; sub: string; done: boolean; sheet: ReactNode }[];
  openId: string | null;
}) {
  // Keyed by openId where it is drawn, so when the day moves on (Finished
  // here, On my way) the new stop's sheet is the one that opens.
  const [open, setOpen] = useState<string | null>(openId);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href^="#sheet-"]');
      if (!a) return;
      e.preventDefault();
      const id = a.getAttribute("href")!.slice("#sheet-".length);
      setOpen(id);
      requestAnimationFrame(() => document.getElementById(`sheet-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job sheet</h2>
      {items.map((item) => {
        const on = open === item.jobId;
        return (
          <div key={item.jobId} id={`sheet-${item.jobId}`} className="scroll-mt-4 rounded-2xl border bg-card">
            <button
              type="button"
              aria-expanded={on}
              onClick={() => setOpen(on ? null : item.jobId)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left"
            >
              {item.done && <Check className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Finished" />}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.sub}</span>
              </span>
              <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${on ? "rotate-180" : ""}`} />
            </button>
            {on && <div className="border-t px-3 pb-4 pt-3">{item.sheet}</div>}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Closing one job out, for the project lead: ask for the final walkthrough
 * with the tools still out, then sign the job off once it is approved.
 * One button at a time, and the reason whenever there isn't one.
 */
export function CloseOutCard({
  jobId,
  customerName,
  walk,
  canAskWalk,
  completed,
}: {
  jobId: string;
  customerName: string;
  walk: { status: WalkthroughStatus; reviewNotes: string | null } | null;
  canAskWalk: { ok: boolean; reason: string | null };
  completed: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    start(async () => {
      const r = await work();
      setMessage(r.message ? { text: r.message, ok: r.ok } : null);
      if (r.ok) {
        setNote("");
        router.refresh();
      }
    });
  }

  let body: ReactNode;
  if (completed) {
    body = (
      <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
        <Check className="h-4 w-4" /> Signed off. Tap Finished here when you leave.
      </p>
    );
  } else if (walk?.status === "requested") {
    body = <p className="text-sm">Walkthrough asked for. Keep the tools out until the manager has walked it.</p>;
  } else if (walk?.status === "approved") {
    body = (
      <div className="grid gap-2">
        <p className="text-sm">Walkthrough approved. Sign the job off.</p>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything the office should know? (optional)"
          className="min-h-11 rounded-lg border bg-background px-3 text-sm"
        />
        <Button type="button" className="min-h-14 text-base" disabled={pending} onClick={() => run(() => leadSignOff(jobId, note))}>
          {pending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <ClipboardCheck className="mr-2 h-5 w-5" />}
          Sign the job off
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="grid gap-2">
        {walk?.status === "rejected" && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-50/70 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
            <p className="font-semibold">Fix these, then ask again:</p>
            <p className="whitespace-pre-line">{walk.reviewNotes || "The manager sent it back."}</p>
          </div>
        )}
        {canAskWalk.ok ? (
          <>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note for the manager (optional)"
              className="min-h-11 rounded-lg border bg-background px-3 text-sm"
            />
            <Button type="button" className="min-h-14 text-base" disabled={pending} onClick={() => run(() => leadRequestWalkthrough(jobId, note || null))}>
              {pending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
              Ask for the final walkthrough
            </Button>
            <p className="text-xs text-muted-foreground">When the work is done. The manager gets a text straight away.</p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{canAskWalk.reason}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-background/60 p-3">
      <p className="mb-2 font-semibold">{customerName}</p>
      {body}
      {message && (
        <p role="status" className={`mt-2 text-sm ${message.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}

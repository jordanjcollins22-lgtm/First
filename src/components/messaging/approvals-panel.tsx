"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, ChevronUp, Mail, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { approveAllOutbound, approveOutbound, declineOutbound } from "@/lib/actions/outbound-approval-actions";
import { staleLine, waitingLine, whatLabel } from "@/lib/outbound-approval";
import type { PendingApproval } from "@/lib/data/outbound-approvals";

/**
 * The emails the machine wrote, waiting to be read.
 *
 * Each one says who it is for, what it is, and how long it stays worth
 * sending, with the words a tap away. Approve sends it as written; Decline
 * closes it and nothing else will try. Approve all is for the morning the
 * list is five booking confirmations and every one of them is fine.
 */
export function ApprovalsPanel({ items }: { items: PendingApproval[] }) {
  const [gone, setGone] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const now = new Date();

  const shown = items.filter((item) => !gone.includes(item.id));
  if (shown.length === 0) return null;

  function act(id: string, run: () => Promise<{ ok: boolean; message: string }>) {
    start(async () => {
      const result = await run();
      setNotes((current) => ({ ...current, [id]: result.message }));
      if (result.ok || /already|too late/i.test(result.message)) setGone((current) => [...current, id]);
    });
  }

  return (
    <section className="mb-6 rounded-2xl border border-amber-400/60 bg-amber-50/60 p-4 shadow-sm backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-amber-700" />
          <p className="font-semibold">{waitingLine(shown.length)}</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await approveAllOutbound();
              setNotes((current) => ({ ...current, all: result.message }));
              if (result.ok) setGone(items.map((item) => item.id));
            })
          }
        >
          Approve all
        </Button>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Nothing goes to a client until you approve it. Tap one to read the words.
      </p>
      {notes.all && <p className="mt-1 text-xs font-medium">{notes.all}</p>}

      <ul className="mt-3 flex flex-col gap-2">
        {shown.map((item) => {
          const stale = staleLine(item.expiresAt, now);
          const isOpen = open === item.id;
          return (
            <li key={item.id} className="rounded-xl border border-border bg-card/80 p-3">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : item.id)}
                className="flex w-full items-start justify-between gap-2 text-left"
                aria-expanded={isOpen}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    {whatLabel(item.kind)} to {item.toName?.trim() || item.toEmail}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{item.subject}</span>
                  {stale && (
                    <span className={`block text-xs ${stale.startsWith("Too late") ? "font-medium text-destructive" : "text-muted-foreground"}`}>
                      {stale}
                    </span>
                  )}
                </span>
                {isOpen ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
              </button>

              {isOpen && (
                <div className="mt-2 rounded-lg border border-border bg-background/70 p-3">
                  <p className="text-xs text-muted-foreground">To {item.toEmail}</p>
                  <p className="mt-1 text-sm font-semibold">{item.subject}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{item.body}</p>
                </div>
              )}

              <div className="mt-2 flex items-center gap-2">
                <Button type="button" size="sm" disabled={pending} onClick={() => act(item.id, () => approveOutbound(item.id))}>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Approve and send
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => act(item.id, () => declineOutbound(item.id))}>
                  <X className="mr-1 h-3.5 w-3.5" />
                  Don&apos;t send
                </Button>
                {notes[item.id] && <span className="text-xs text-muted-foreground">{notes[item.id]}</span>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

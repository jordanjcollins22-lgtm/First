"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { approveQueueItem, declineQueueItem } from "@/lib/actions/approval-queue-actions";
import { DECLINE_REASONS, DECLINE_REASON_LABEL, type DeclineReason } from "@/lib/approvals/declines";
import { QUEUE_TYPE_LABEL, type QueueItem } from "@/lib/approvals/queue";
import { staleLine } from "@/lib/outbound-approval";

/**
 * One row per thing waiting on the owner, with one button to say yes, one
 * tap for a reason to say no, and a link to open it in full. An email's
 * words open in place, because reading it is the approval.
 */
export function ApprovalQueueList({ items }: { items: QueueItem[] }) {
  const [gone, setGone] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [declining, setDeclining] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const now = new Date();

  const key = (i: QueueItem) => `${i.type}:${i.id}`;
  const shown = items.filter((i) => !gone.includes(key(i)));

  function run(item: QueueItem, work: () => Promise<{ ok: boolean; message: string }>, keepOnSuccess = false) {
    const k = key(item);
    start(async () => {
      const result = await work();
      setNotes((n) => ({ ...n, [k]: result.message }));
      setDeclining(null);
      // Gone when done, or when somebody else already dealt with it.
      if ((result.ok && !keepOnSuccess) || /already|too late/i.test(result.message)) setGone((g) => [...g, k]);
    });
  }

  if (shown.length === 0) {
    return <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nothing is waiting for you.</p>;
  }

  return (
    <ul className="grid gap-2">
      {shown.map((item) => {
        const k = key(item);
        const stale = item.dueAt ? staleLine(item.dueAt, now) : null;
        return (
          <li key={k} className="rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => setOpen(open === k ? null : k)}
                aria-expanded={open === k}
                disabled={!item.body}
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{QUEUE_TYPE_LABEL[item.type]}</span>
                  <span className="font-semibold">{item.title}</span>
                </span>
                {item.detail && <span className="mt-0.5 block text-sm text-muted-foreground">{item.detail}</span>}
                {stale && <span className="mt-0.5 block text-xs font-medium text-amber-700 dark:text-amber-300">{stale}</span>}
              </button>
              <div className="flex flex-wrap gap-2">
                {item.canApprove && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(item, () => approveQueueItem(item.type, item.id))}
                    className="min-h-11 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {item.approveLabel}
                  </button>
                )}
                {item.canDecline && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setDeclining(declining === k ? null : k)}
                    aria-expanded={declining === k}
                    className="min-h-11 rounded-lg border px-3 text-sm font-semibold disabled:opacity-50"
                  >
                    {item.type === "price" ? "Change price" : "Decline"}
                  </button>
                )}
                {item.href && (
                  <Link href={item.href} className="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm font-semibold">
                    Open
                  </Link>
                )}
              </div>
            </div>

            {declining === k && (
              <div className="mt-3 grid gap-2">
                <p className="text-sm font-medium">Why not?</p>
                <div className="flex flex-wrap gap-2">
                  {DECLINE_REASONS.map((reason: DeclineReason) => (
                    <button
                      key={reason}
                      type="button"
                      disabled={pending}
                      onClick={() => run(item, () => declineQueueItem(item.type, item.id, reason), item.type === "price")}
                      className="min-h-11 rounded-full border px-3 text-sm hover:bg-muted disabled:opacity-50"
                    >
                      {DECLINE_REASON_LABEL[reason]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {open === k && item.body && (
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-3 font-sans text-sm">{item.body}</pre>
            )}
            {notes[k] && <p className="mt-2 text-xs font-medium" role="status">{notes[k]}</p>}
          </li>
        );
      })}
    </ul>
  );
}

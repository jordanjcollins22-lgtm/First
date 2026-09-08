"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import {
  blocksSending,
  canWaiveClientApproval,
  isScopeChangeOpen,
  SCOPE_STATUS_LABEL,
  waitingOn,
  type ScopeChangeStatus,
} from "@/lib/exceptions";
import { money } from "@/lib/proposal-update-notice";
import {
  approveWithoutClient,
  priceScopeChange,
  recordClientDecision,
  rejectScopeChange,
  reviewScopeChange,
  sendScopeChangeToClient,
} from "@/lib/actions/exception-actions";
import type { ScopeChange } from "@/lib/data/exceptions";

const CHANNELS = [
  ["phone", "On the phone"],
  ["in_person", "In person"],
  ["email", "By email"],
  ["sms", "By text"],
  ["portal", "On their proposal link"],
  ["other", "Some other way"],
] as const;

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
}

/**
 * The client asked for something that was not sold, and this is what happens
 * to it.
 *
 * Read-only for anybody who is not selling. That is not a courtesy: reviewing,
 * pricing and agreeing a change is the account manager's job, and a crew that
 * could approve their own change request could enlarge the work they are being
 * paid to do. The server refuses it too -- this only stops somebody being
 * shown a button that would fail.
 *
 * What the crew *does* get from this panel is the answer to "can I do it yet",
 * which is the question they actually have.
 */
export function ScopeChangesPanel({
  changes,
  canReview,
}: {
  changes: ScopeChange[];
  canReview: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [terms, setTerms] = useState("");
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<(typeof CHANNELS)[number][0]>("phone");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const result = await fn();
      if (!result.ok) setError(result.error ?? "That did not work.");
      else {
        setBusy(null);
        setPrice("");
        setTerms("");
        setNote("");
        router.refresh();
      }
    });
  }

  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">Nobody has asked for anything beyond what was sold.</p>;
  }

  return (
    <section className="space-y-3">
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="space-y-2">
        {changes.map((c) => {
          const desk = waitingOn(c.status as ScopeChangeStatus);
          const cannotSend = blocksSending({
            status: c.status,
            reviewedAt: c.reviewedAt,
            priceCents: c.priceCents,
            pricedAt: c.pricedAt,
            clientApprovalRequired: c.clientApprovalRequired,
            approvalWaivedReason: c.approvalWaivedReason,
            clientDecision: c.clientDecision,
            executableAt: c.executableAt,
          });
          const editing = busy === c.id;

          return (
            <li key={c.id} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    "rounded px-1.5 py-0.5 text-xs font-medium " +
                    (c.status === "client_approved"
                      ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-200"
                      : isScopeChangeOpen(c.status)
                        ? "bg-amber-500/15 text-amber-900 dark:text-amber-200"
                        : "bg-muted text-muted-foreground")
                  }
                >
                  {SCOPE_STATUS_LABEL[c.status]}
                </span>
                {c.priceCents != null && <span className="text-xs font-medium">{money(c.priceCents)}</span>}
                {c.pricedAt != null && c.priceCents == null && <span className="text-xs">No charge</span>}
                {desk && (
                  <span className="text-xs text-muted-foreground">
                    with {desk === "client" ? "the client" : "the account manager"}
                  </span>
                )}
              </div>

              <p className="text-sm">{c.requestedNote}</p>
              <p className="text-xs text-muted-foreground">
                Reported by {c.requestedByName ?? "somebody"} · {when(c.requestedAt)}
                {c.reviewedByName ? ` · reviewed by ${c.reviewedByName}` : ""}
              </p>

              {c.executableAt && (
                <p className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-900 dark:text-emerald-200">
                  Approved {when(c.executableAt)}
                  {c.clientDecisionChannel ? ` — ${c.clientDecisionChannel.replace("_", " ")}` : ""}
                  {c.approvalWaivedReason ? ` — no client approval needed: ${c.approvalWaivedReason}` : ""}. The crew
                  can do this.
                </p>
              )}
              {c.terms && <p className="text-xs text-muted-foreground">Terms: {c.terms}</p>}
              {c.clientDecisionNote && (
                <p className="text-xs text-muted-foreground">Client said: {c.clientDecisionNote}</p>
              )}

              {!canReview && isScopeChangeOpen(c.status) && (
                <p className="text-xs text-muted-foreground">
                  Not approved yet — don&apos;t do this work until it is.
                </p>
              )}

              {canReview && isScopeChangeOpen(c.status) && !editing && (
                <div className="flex flex-wrap gap-2">
                  {c.status === "reported" && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => reviewScopeChange(c.id))}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                    >
                      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} I&apos;ll take it
                    </button>
                  )}
                  {(c.status === "in_review" || c.status === "priced") && (
                    <button
                      type="button"
                      onClick={() => setBusy(c.id)}
                      className="min-h-11 rounded-md border border-border px-3 text-sm"
                    >
                      {c.pricedAt ? "Change the price" : "Price it"}
                    </button>
                  )}
                  {(c.status === "in_review" || c.status === "priced") && !cannotSend && (
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => sendScopeChangeToClient(c.id))}
                      className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm"
                    >
                      Send to the client <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {c.status === "sent_to_client" && (
                    <>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(() => recordClientDecision({ id: c.id, decision: "approved", channel, note }))
                        }
                        className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                      >
                        They said yes
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          run(() => recordClientDecision({ id: c.id, decision: "declined", channel, note }))
                        }
                        className="min-h-11 rounded-md border border-border px-3 text-sm"
                      >
                        They said no
                      </button>
                      <select
                        value={channel}
                        onChange={(e) => setChannel(e.target.value as (typeof CHANNELS)[number][0])}
                        className="min-h-11 rounded-md border border-border bg-background px-2 text-sm"
                      >
                        {CHANNELS.map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {canWaiveClientApproval(c.priceCents) && c.status !== "sent_to_client" && c.reviewedAt && (
                    <button
                      type="button"
                      disabled={pending || note.trim() === ""}
                      onClick={() => run(() => approveWithoutClient({ id: c.id, reason: note }))}
                      title="Only for changes at no charge"
                      className="min-h-11 rounded-md border border-border px-3 text-sm disabled:opacity-50"
                    >
                      Approve without asking them
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={pending || note.trim() === ""}
                    onClick={() => run(() => rejectScopeChange(c.id, note))}
                    className="min-h-11 rounded-md px-3 text-sm text-muted-foreground disabled:opacity-50"
                  >
                    Not offering it
                  </button>
                </div>
              )}

              {canReview && isScopeChangeOpen(c.status) && cannotSend && c.status !== "reported" && !editing && (
                <p className="text-xs text-muted-foreground">{cannotSend}</p>
              )}

              {canReview && isScopeChangeOpen(c.status) && (
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="A note for the record — required to reject or to skip the client"
                  className="min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
                />
              )}

              {canReview && editing && (
                <div className="space-y-2 rounded-md border border-border p-2">
                  <label className="block text-xs font-medium">
                    Price, in dollars — leave empty for no charge
                    <input
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      inputMode="decimal"
                      placeholder="250.00"
                      className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Terms
                    <input
                      value={terms}
                      onChange={(e) => setTerms(e.target.value)}
                      placeholder="Added to the final invoice"
                      className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        const trimmed = price.trim();
                        const cents = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
                        if (cents != null && !Number.isFinite(cents)) {
                          setError("That is not a number.");
                          return;
                        }
                        run(() => priceScopeChange({ id: c.id, priceCents: cents, terms }));
                      }}
                      className="min-h-11 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                    >
                      {price.trim() === "" ? "It's free" : "Set the price"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setBusy(null)}
                      className="min-h-11 px-2 text-sm text-muted-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

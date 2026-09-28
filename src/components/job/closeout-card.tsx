"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Circle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { approveAndSignOff, recordApprovalInPerson, sendBeforeAftersToClient } from "@/lib/actions/client-review-actions";
import type { CloseoutStep, Verdict } from "@/lib/project-closeout";

/**
 * Closing the job, in the order it happens: walk it in person, take the
 * final afters, send the client the befores and afters, the client
 * approves, you approve and it is signed off. Each step says what is
 * missing, and the button for the next one is the only button shown.
 */
export function CloseoutCard({
  jobId,
  steps,
  canSend,
  canSignOff,
  canAct,
  sendTo,
  preview,
  reviewLink,
  costStart,
}: {
  jobId: string;
  steps: CloseoutStep[];
  canSend: Verdict;
  canSignOff: Verdict;
  /** Owner, admin or account manager: the people who close a job. */
  canAct: boolean;
  sendTo: string | null;
  preview: { subject: string; text: string } | null;
  /** The link the client was sent, to copy and text. */
  reviewLink: string | null;
  /** What the real cost starts from: the clock, the budget's materials, the receipts; and the budget beside it. */
  costStart?: { crewHours: number; materialsCents: number; otherCents: number; budgetHours: number | null; budgetCents: number | null } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [hours, setHours] = useState(costStart ? String(costStart.crewHours) : "");
  const [materials, setMaterials] = useState(costStart ? String(Math.round(costStart.materialsCents / 100)) : "");
  const [other, setOther] = useState(costStart ? String(Math.round(costStart.otherCents / 100)) : "0");
  const [costNote, setCostNote] = useState("");
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(/[$,\s]/g, "")));

  const nextKey = steps.find((s) => !s.done)?.key ?? null;
  const signedOff = steps.every((s) => s.done);

  function run(action: () => Promise<{ ok: boolean; message: string }>) {
    setMessage(null);
    start(async () => {
      const result = await action();
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setPreviewing(false);
        router.refresh();
      }
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-white/60 bg-card/60 p-4 backdrop-blur-md">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Sign-off</h2>
        <p className="text-xs text-muted-foreground">{signedOff ? "Signed off" : "Only once the client is happy"}</p>
      </div>

      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            {step.done ? (
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${step.key === nextKey ? "text-amber-600" : "text-muted-foreground/60"}`} />
            )}
            <div className="min-w-0 flex-1">
              <p className={step.done ? "text-muted-foreground" : step.key === nextKey ? "font-medium" : "text-muted-foreground"}>
                {i + 1}. {step.label}
              </p>
              {step.note && !step.done && <p className="text-xs text-muted-foreground">{step.note}</p>}
              {step.note && step.done && step.key === "send" && <p className="text-xs text-muted-foreground">{step.note}</p>}
            </div>
          </li>
        ))}
      </ol>

      {!signedOff && canAct && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {nextKey === "walk" && (
            <Link href={`/jobs/${jobId}?open=walkthrough`} className="text-sm font-medium text-primary hover:underline">
              Open the walkthrough
            </Link>
          )}
          {nextKey === "afters" && (
            <Link href={`/jobs/${jobId}/work-order`} className="text-sm font-medium text-primary hover:underline">
              Take the afters on the crew sheet
            </Link>
          )}

          {(nextKey === "send" || nextKey === "client") && canSend.ok && (
            <>
              {previewing && preview ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 text-sm">
                  <p className="text-xs text-muted-foreground">To {sendTo}</p>
                  <p className="font-medium">{preview.subject}</p>
                  <pre className="whitespace-pre-wrap font-sans text-sm text-muted-foreground">{preview.text}</pre>
                  <p className="text-xs text-muted-foreground">The link opens their befores and afters with Approve and &ldquo;Something isn&apos;t right&rdquo;.</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" className="flex-1" onClick={() => setPreviewing(false)} disabled={pending}>
                      Back
                    </Button>
                    <Button type="button" className="flex-1" onClick={() => run(() => sendBeforeAftersToClient(jobId))} disabled={pending}>
                      {pending ? "Sending…" : "Send"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {sendTo ? (
                    <Button type="button" onClick={() => setPreviewing(true)} disabled={pending}>
                      {nextKey === "client" ? "Send again" : "Preview & send to client"}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">No email on file for the client.</p>
                  )}
                  <Button type="button" variant="outline" onClick={() => run(() => recordApprovalInPerson(jobId))} disabled={pending}>
                    They approved it in person
                  </Button>
                </div>
              )}
            </>
          )}
          {(nextKey === "send" || nextKey === "client") && !canSend.ok && <p className="text-sm text-muted-foreground">{canSend.reason}</p>}

          {nextKey === "client" && reviewLink && (
            <button
              type="button"
              className="self-start text-xs text-primary hover:underline"
              onClick={() => {
                void navigator.clipboard?.writeText(reviewLink).then(() => setMessage({ ok: true, text: "Link copied. Text it to them if the email hasn't landed." }));
              }}
            >
              Copy their link
            </button>
          )}

          {nextKey === "approve" && (
            canSignOff.ok ? (
              // The final submission: what the job really cost goes in with it,
              // and the project review is scored on it from here on.
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-background/70 p-3">
                <p className="text-sm font-semibold">What did it really cost?</p>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    Crew hours
                    <input inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} className="h-10 rounded-md border border-border bg-background px-2 text-sm" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    Materials $
                    <input inputMode="decimal" value={materials} onChange={(e) => setMaterials(e.target.value)} className="h-10 rounded-md border border-border bg-background px-2 text-sm" />
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium">
                    Anything else $
                    <input inputMode="decimal" value={other} onChange={(e) => setOther(e.target.value)} className="h-10 rounded-md border border-border bg-background px-2 text-sm" />
                  </label>
                </div>
                <input
                  value={costNote}
                  onChange={(e) => setCostNote(e.target.value)}
                  placeholder="Anything else was what? (dump fee, rental, a sub…)"
                  className="h-10 rounded-md border border-border bg-background px-2 text-sm"
                />
                {costStart && (
                  <p className="text-[11px] text-muted-foreground">
                    Filled in from the clock ({costStart.crewHours} hrs), the materials it was priced with, and the receipts. Change anything that
                    isn&apos;t right.
                    {costStart.budgetHours != null && ` Budget: ${costStart.budgetHours} hrs`}
                    {costStart.budgetCents != null && `, $${Math.round(costStart.budgetCents / 100).toLocaleString("en-US")} cost.`}
                  </p>
                )}
                <Button
                  type="button"
                  onClick={() =>
                    run(() =>
                      approveAndSignOff(jobId, { crewHours: num(hours), materialsDollars: num(materials), otherDollars: num(other), note: costNote })
                    )
                  }
                  disabled={pending}
                >
                  {pending ? "Signing off…" : "Approve & sign off the job"}
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{canSignOff.reason}</p>
            )
          )}
        </div>
      )}

      {message && <p className={`text-sm ${message.ok ? "text-emerald-700" : "text-destructive"}`}>{message.text}</p>}
    </section>
  );
}

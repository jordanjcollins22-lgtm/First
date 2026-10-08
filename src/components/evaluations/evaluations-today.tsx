import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, MapPin } from "lucide-react";

import { cn } from "@/lib/utils";
import { EVALUATION_STEPS, evaluationStepState } from "@/lib/evaluations-today";
import type { EvaluationToday } from "@/lib/data/evaluations-today";
import { ClientChange } from "@/components/schedule/client-change";
import { PreEvalAsk } from "@/components/evaluations/pre-eval-ask";

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

/**
 * Evaluations today: one card per visit, a bar for where it has got to,
 * anything wrong, and the button when it is the account manager's move.
 */
export function EvaluationsToday({ evaluations }: { evaluations: EvaluationToday[] }) {
  if (evaluations.length === 0) {
    return <p className="rounded-xl border border-border bg-card/60 px-3 py-3 text-sm text-muted-foreground">No evaluations today.</p>;
  }
  const late = evaluations.filter((e) => e.stage.late).length;
  const toPrice = evaluations.filter((e) => e.stage.yourMove === "price").length;
  const toSend = evaluations.filter((e) => e.stage.yourMove === "send").length;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {evaluations.length} today
        {late > 0 ? ` · ${late} late` : ""}
        {toPrice > 0 ? ` · ${toPrice} to price` : ""}
        {toSend > 0 ? ` · ${toSend} to send` : ""}
      </p>
      <ul className="flex flex-col gap-3">
        {evaluations.map((e) => (
          <EvaluationCard key={e.jobId} evaluation={e} />
        ))}
      </ul>
    </div>
  );
}

function EvaluationCard({ evaluation: e }: { evaluation: EvaluationToday }) {
  const { stage } = e;
  return (
    <li className={cn("rounded-2xl border bg-card p-3 shadow-sm", stage.late ? "border-red-400" : stage.yourMove ? "border-emerald-400" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <Link href={`/jobs/${e.jobId}`} className="min-w-0">
          <p className="font-semibold">{e.client}</p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {e.address}
              {e.evaluator ? ` · ${e.evaluator}` : ""}
            </span>
          </p>
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 shrink-0" /> {time(e.dueAt)}
          </p>
        </Link>
        {stage.late ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
            <AlertTriangle className="h-3 w-3" /> Late
          </span>
        ) : stage.yourMove ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-3 w-3" /> {stage.yourMove === "price" ? "Ready to price" : "Ready to send"}
          </span>
        ) : null}
      </div>

      <div className="mt-3" aria-label={`Step: ${stage.now}`}>
        <div className="flex gap-1">
          {EVALUATION_STEPS.map((s, i) => {
            const st = evaluationStepState(i, stage, e.preEval);
            return (
              <div
                key={s}
                className={cn(
                  "h-2.5 flex-1 rounded-full",
                  st === "done" ? "bg-emerald-500" : st === "now" ? "animate-pulse bg-sky-500" : st === "missing" ? "bg-amber-400" : "bg-muted"
                )}
              />
            );
          })}
        </div>
        <div className="mt-1 flex gap-1">
          {EVALUATION_STEPS.map((s, i) => {
            const st = evaluationStepState(i, stage, e.preEval);
            return (
              <span
                key={s}
                className={cn(
                  "flex-1 text-center text-[10px] leading-tight",
                  st === "now"
                    ? "font-semibold text-foreground"
                    : st === "done"
                      ? "text-emerald-700"
                      : st === "missing"
                        ? "font-semibold text-amber-700"
                        : "text-muted-foreground"
                )}
              >
                {st === "missing" ? "No pre-eval" : s}
              </span>
            );
          })}
        </div>
      </div>

      <p className="mt-2 text-sm">
        <span className="font-medium">{stage.now}</span>
        {stage.since && <span className="text-xs text-muted-foreground"> since {time(stage.since)}</span>}
      </p>
      {e.areasTotal > 0 && stage.step >= 3 && (
        <p className="text-xs text-muted-foreground">
          Areas: {e.areasReviewed} of {e.areasTotal} reviewed
        </p>
      )}
      {stage.issues.map((issue) => (
        <p key={issue} className={cn("mt-1 rounded-lg px-2 py-1 text-xs", issue.includes("late") || issue.startsWith("Late") ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900")}>
          {issue}
        </p>
      ))}
      {stage.yourMove && (
        <Link
          href={e.reviewHref}
          className="mt-3 flex h-11 w-full items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
        >
          {stage.yourMove === "price" ? "Price it" : "Review and send"}
        </Link>
      )}
      {/* No pre-eval and nobody there yet: the form, by email, after a look at the email. */}
      {!e.preEval && stage.step < 3 && <PreEvalAsk jobId={e.jobId} askedAt={e.preEvalAskedAt} />}
      {e.preEval && (
        <Link href={`/jobs/${e.jobId}`} className="mt-2 block text-sm font-medium text-primary hover:underline">
          Read their pre-eval →
        </Link>
      )}
      {/* Only before the visit has happened: after it, there is nothing to move. */}
      {stage.step < 3 && <ClientChange target={{ kind: "evaluation", jobId: e.jobId }} />}
    </li>
  );
}

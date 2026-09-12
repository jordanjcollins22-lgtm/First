import { AlertTriangle, Check, ShieldAlert, X } from "lucide-react";

import { GATE_LABEL, readinessLine, type GateKey, type GateResult } from "@/lib/readiness";
import { OverrideControl } from "@/components/readiness/override-control";

/**
 * Why a job is not ready, in the words of the checks themselves.
 *
 * Never a bare Ready / Not ready. Somebody looking at this needs to know which
 * one thing to go and fix, so every check is listed with a tick or a cross and
 * the cross says what would clear it.
 *
 * A check let past keeps its cross. Underneath it says who let it past, when,
 * and why -- because "access confirmed" and "access not confirmed, and Jordan
 * took responsibility for that at 7:40 because the client rang" are different
 * facts, and only the second one is true.
 */
export function ReadinessPanel({
  jobId,
  result,
  canOverride,
}: {
  jobId: string;
  result: GateResult;
  canOverride: boolean;
}) {
  const line = readinessLine(result);

  return (
    <section className="rounded-lg border border-border/60">
      <header
        className={`flex flex-wrap items-center justify-between gap-2 rounded-t-lg px-3 py-2 ${
          result.open ? "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300" : "bg-amber-500/10 text-amber-900 dark:text-amber-200"
        }`}
      >
        <p className="text-sm font-semibold">
          {result.open ? GATE_LABEL[result.gate] : `Not ${GATE_LABEL[result.gate].toLowerCase()}`}
        </p>
        <p className="text-xs">{line}</p>
      </header>

      <ul className="divide-y divide-border/50">
        {result.checks.map((check) => (
          <li key={check.key} className="px-3 py-2">
            <div className="flex items-start gap-2">
              {check.passed ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="Passed" />
              ) : (
                <X
                  className={`mt-0.5 h-4 w-4 shrink-0 ${check.stopping ? "text-destructive" : "text-amber-600"}`}
                  aria-label="Failed"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {check.label}
                  {!check.blocking && !check.passed && (
                    <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
                      warning only
                    </span>
                  )}
                </p>
                {!check.passed && check.reason && (
                  <p className="mt-0.5 text-xs text-muted-foreground">{check.reason}</p>
                )}
                {check.override && (
                  <p className="mt-1 flex items-start gap-1.5 rounded bg-muted/60 px-2 py-1 text-xs">
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-700" />
                    <span>
                      Still failing. Let past by <strong>{check.override.byName ?? "a manager"}</strong> on{" "}
                      {new Date(check.override.at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      : {check.override.reason}
                    </span>
                  </p>
                )}
              </div>
              {!check.passed && check.blocking && (
                <OverrideControl
                  jobId={jobId}
                  gate={result.gate}
                  checkKey={check.key}
                  checkLabel={check.label}
                  overridden={check.override != null}
                  canOverride={canOverride}
                />
              )}
            </div>
          </li>
        ))}
      </ul>

      {result.blockingIssues.length > 0 && (
        <div className="border-t border-border/50 px-3 py-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {result.blockingIssues.length} open{" "}
            {result.blockingIssues.length === 1 ? "issue is" : "issues are"} holding this gate
          </p>
          <ul className="mt-1 space-y-0.5">
            {result.blockingIssues.map((issue) => (
              <li key={issue.id} className="text-xs text-muted-foreground">
                {issue.title}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-muted-foreground">
            An issue is resolved on the Issues tab, not overridden here.
          </p>
        </div>
      )}
    </section>
  );
}

/** The same thing at one line, for a list of jobs. */
export function ReadinessBadge({ result }: { result: GateResult }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
        result.open
          ? "bg-emerald-600/15 text-emerald-800 dark:text-emerald-300"
          : "bg-amber-500/20 text-amber-900 dark:text-amber-200"
      }`}
    >
      {readinessLine(result)}
    </span>
  );
}

export type { GateKey };

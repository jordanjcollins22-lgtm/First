"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2, Plus } from "lucide-react";

import {
  ISSUE_TYPES,
  ISSUE_TYPE_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  sortIssues,
  summarise,
  type Issue,
  type IssueSeverity,
  type IssueType,
} from "@/lib/issues";
import { raiseIssue, resolveIssue, setIssueBlocking } from "@/lib/actions/issue-actions";

const SEVERITY_STYLE: Record<IssueSeverity, string> = {
  critical: "bg-destructive/15 text-destructive",
  blocking: "bg-amber-500/20 text-amber-900 dark:text-amber-200",
  warning: "bg-amber-500/10 text-amber-800 dark:text-amber-200",
  info: "bg-muted text-muted-foreground",
};

/**
 * Everything wrong with this job, and what is being done about it.
 *
 * Raising one is two taps and a sentence, because an issue somebody cannot be
 * bothered to file is an issue told to a colleague in a van and lost. Closing
 * one needs a word on what happened, because an issue that closes silently is
 * the one somebody re-opens in three weeks having learned nothing.
 */
export function IssuesPanel({
  jobId,
  issues,
  canDecideBlocking,
  compact = false,
}: {
  jobId: string;
  issues: Issue[];
  canDecideBlocking: boolean;
  /** The Field tab: raising only, no management. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<IssueType>("material");
  const [severity, setSeverity] = useState<IssueSeverity>("blocking");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [resolving, setResolving] = useState<string | null>(null);
  const [resolution, setResolution] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const rows = sortIssues(issues);
  const line = summarise(issues);

  function submit() {
    setError(null);
    start(async () => {
      const result = await raiseIssue({ jobId, type, severity, title, description });
      if (!result.ok) setError(result.error);
      else {
        setOpen(false);
        setTitle("");
        setDescription("");
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-3">
      {line && (
        <p className="flex items-center gap-1.5 text-sm">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          {line}
        </p>
      )}

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <Plus className="h-4 w-4" /> Report an issue
        </button>
      ) : (
        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs font-medium">
              What kind
              <select
                value={type}
                onChange={(e) => setType(e.target.value as IssueType)}
                className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                {ISSUE_TYPES.map((key) => (
                  <option key={key} value={key}>
                    {ISSUE_TYPE_LABEL[key]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium">
              How bad
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
                className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
              >
                {SEVERITIES.map((key) => (
                  <option key={key} value={key}>
                    {SEVERITY_LABEL[key]}
                    {key === "blocking" || key === "critical" ? " — stops the job" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="No mulch on the truck"
            className="min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="Anything else worth knowing."
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={pending || title.trim() === ""}
              onClick={submit}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />} Report it
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted-foreground underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing reported on this job.</p>
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
          {rows.map((issue) => (
            <li key={issue.id} className={`px-3 py-2.5 ${issue.status !== "open" ? "opacity-60" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {issue.title}
                    <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium ${SEVERITY_STYLE[issue.severity]}`}>
                      {SEVERITY_LABEL[issue.severity]}
                    </span>
                    {issue.blocking && issue.status === "open" && (
                      <span className="ml-1 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                        stopping the job
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ISSUE_TYPE_LABEL[issue.type]}
                    {issue.createdByName ? ` · ${issue.createdByName}` : ""} ·{" "}
                    {new Date(issue.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                  {issue.description && <p className="mt-1 text-xs">{issue.description}</p>}
                  {issue.resolution && (
                    <p className="mt-1 flex items-start gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                      <Check className="mt-0.5 h-3 w-3 shrink-0" />
                      {issue.resolution}
                      {issue.resolvedByName ? ` — ${issue.resolvedByName}` : ""}
                    </p>
                  )}
                </div>

                {issue.status === "open" && !compact && (
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => setResolving(resolving === issue.id ? null : issue.id)}
                      className="text-xs text-primary underline"
                    >
                      Resolve
                    </button>
                    {canDecideBlocking && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const result = await setIssueBlocking({
                              issueId: issue.id,
                              jobId,
                              blocking: !issue.blocking,
                            });
                            if (!result.ok) setError(result.error);
                            else router.refresh();
                          })
                        }
                        className="text-[11px] text-muted-foreground underline"
                      >
                        {issue.blocking ? "Does not stop the job" : "Stops the job"}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {resolving === issue.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    placeholder="What was done about it"
                    className="min-h-10 flex-1 rounded-md border border-border bg-background px-2 text-sm"
                  />
                  <button
                    type="button"
                    disabled={pending || resolution.trim() === ""}
                    onClick={() =>
                      start(async () => {
                        const result = await resolveIssue({ issueId: issue.id, jobId, resolution });
                        if (!result.ok) setError(result.error);
                        else {
                          setResolving(null);
                          setResolution("");
                          router.refresh();
                        }
                      })
                    }
                    className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

import { DECISION_LABEL, type Decision } from "@/lib/outreach-agent";
import type { SeenRow } from "@/lib/data/outreach-agent";
import { shortWhen } from "@/lib/time-zone";

/**
 * Every post the agent has looked at, and what it did.
 *
 * Read-only. The things a person acts on from here are a lead that went
 * over the cap (open the post, answer it) and a comment that failed to go
 * up (open the post, paste it). Both are a link away.
 */
const TONE: Record<Decision, string> = {
  posted: "text-emerald-700",
  queued: "text-sky-700",
  ready: "text-sky-700",
  capped: "text-amber-700",
  failed: "text-red-700",
  not_request: "text-muted-foreground",
  too_old: "text-muted-foreground",
  draft_failed: "text-muted-foreground",
  skipped: "text-muted-foreground",
  not_member: "text-amber-700",
  outside_area: "text-muted-foreground",
  declined: "text-muted-foreground",
  read: "text-sky-700",
  advert: "text-muted-foreground",
};

export function AgentActivity({ rows }: { rows: SeenRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing yet. Once the extension is running, what it finds shows here.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {rows.filter((row) => row.decision !== "ready").map((row) => (
        <li key={row.id} className="space-y-1 py-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span className={`font-medium ${TONE[row.decision] ?? ""}`}>{DECISION_LABEL[row.decision] ?? row.decision}</span>
            <span className="text-xs text-muted-foreground">
              {row.groupName ?? "Group"}
              {row.author ? ` · ${row.author}` : ""}
              {row.ageDays != null ? ` · ${row.ageDays === 0 ? "today" : `${row.ageDays}d old`}` : ""} · {shortWhen(row.createdAt)}
            </span>
          </div>
          {row.text && <p className="line-clamp-2 text-muted-foreground">{row.text}</p>}
          {row.reason && <p className="text-xs text-muted-foreground">{row.reason}</p>}
          {row.comment && (row.decision === "posted" || row.decision === "ready" || row.decision === "failed" || row.decision === "queued") && (
            <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">{row.comment}</p>
          )}
          <div className="flex flex-wrap gap-3 text-xs">
            <a href={row.url} target="_blank" rel="noreferrer" className="underline">
              Open the post
            </a>
            {row.code && (
              <span className="text-muted-foreground">
                Link {row.code} · {row.clicks} open{row.clicks === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

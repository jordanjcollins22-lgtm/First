"use client";

import { useState, useTransition } from "react";
import { Check, Copy, ExternalLink, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { approveAgentComment, declineAgentComment, markAgentCommentPosted } from "@/lib/actions/outreach-agent-actions";
import type { SeenRow } from "@/lib/data/outreach-agent";
import { findPostUrl } from "@/lib/outreach-agent";
import { shortWhen } from "@/lib/time-zone";

/**
 * The comments the agent wrote and is holding for a yes.
 *
 * One card per post: who asked, in which group, what they said, and the
 * comment as it would go up. The words can be changed before approving.
 * Approve and the browser posts it on its next minute; decline and the
 * post is left alone for good.
 */
export function AgentReview({ rows }: { rows: SeenRow[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = rows.filter((r) => !gone.has(r.id));
  if (shown.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing waiting. When it writes one, it shows here for you to approve.</p>;
  }

  function decide(row: SeenRow, what: "approve" | "decline" | "pasted") {
    setMessage(null);
    startTransition(async () => {
      const result =
        what === "approve"
          ? await approveAgentComment({ seenId: row.id, comment: drafts[row.id] ?? row.comment ?? "" })
          : what === "pasted"
            ? await markAgentCommentPosted(row.id)
            : await declineAgentComment({ seenId: row.id });
      if (result.ok) setGone((s) => new Set(s).add(row.id));
      else setMessage(result.error);
    });
  }

  return (
    <div className="space-y-3">
      {shown.map((row) => (
        <div key={row.id} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{row.author ?? "Someone"}</span>
              {row.groupName ? ` in ${row.groupName}` : ""}
              {row.ageDays != null ? ` · posted ${row.ageDays === 0 ? "today" : `${row.ageDays}d ago`}` : ""}
            </span>
            <span>found {shortWhen(row.createdAt)}</span>
          </div>
          {row.text && <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{row.text}</p>}
          <a href={row.url || findPostUrl(row.text ?? "")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
            {row.url ? "Open the post" : "Find it on Facebook"} <ExternalLink className="h-3 w-3" />
          </a>
          {!row.url && (
            <p className="text-xs text-amber-700">
              The page showed this post without a link, so it can&apos;t be posted for you. Copy the comment, paste it under
              the post, then press &ldquo;I posted it&rdquo;.
            </p>
          )}
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">The comment</p>
            <Textarea
              value={drafts[row.id] ?? row.comment ?? ""}
              rows={4}
              disabled={pending}
              onChange={(e) => setDrafts((d) => ({ ...d, [row.id]: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {row.url ? (
              <Button type="button" size="sm" disabled={pending} onClick={() => decide(row, "approve")}>
                <Check className="mr-1 h-4 w-4" /> Approve and post
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => navigator.clipboard?.writeText(drafts[row.id] ?? row.comment ?? "").catch(() => {})}
                >
                  <Copy className="mr-1 h-4 w-4" /> Copy comment
                </Button>
                <Button type="button" size="sm" disabled={pending} onClick={() => decide(row, "pasted")}>
                  <Check className="mr-1 h-4 w-4" /> I posted it
                </Button>
              </>
            )}
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => decide(row, "decline")}>
              <X className="mr-1 h-4 w-4" /> Decline
            </Button>
          </div>
        </div>
      ))}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}

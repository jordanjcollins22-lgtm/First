"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Loader2, PenLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { acceptAgentPost, passAgentPost } from "@/lib/actions/outreach-agent-actions";
import type { SeenRow } from "@/lib/data/outreach-agent";
import { findPostUrl } from "@/lib/outreach-agent";
import { shortWhen } from "@/lib/time-zone";

/**
 * Every post the browser read, for the owner to pick from.
 *
 * Newest first. The ones that mentioned the work are marked and shown by
 * default, with a switch to see the rest. "Write a comment" writes one for
 * that post and moves it to "Comments to approve"; "Pass" puts it away.
 * Either way the pick is kept, as a record of which posts a person would
 * answer.
 */
export function AgentPicker({ rows }: { rows: SeenRow[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);
  const [, startTransition] = useTransition();

  const left = rows.filter((r) => !gone.has(r.id));
  const matched = left.filter((r) => r.matched !== false);
  const shown = showAll ? left : matched;

  function pick(row: SeenRow, what: "accept" | "pass") {
    setBusy(row.id);
    setErrors((e) => ({ ...e, [row.id]: "" }));
    startTransition(async () => {
      const result = what === "accept" ? await acceptAgentPost(row.id) : await passAgentPost(row.id);
      setBusy(null);
      if (result.ok) setGone((s) => new Set(s).add(row.id));
      else setErrors((e) => ({ ...e, [row.id]: result.error }));
    });
  }

  if (left.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing to pick yet. Press Look now in the extension and the posts it reads show up here.</p>;
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        Show every post it read ({left.length}), not only the {matched.length} that mention the work
      </label>
      {shown.length === 0 && <p className="text-sm text-muted-foreground">None of these mention the work. Tick the box to see them all.</p>}
      {shown.map((row) => {
        const open = expanded.has(row.id);
        const long = (row.text ?? "").length > 280;
        const link = row.url || findPostUrl(row.text ?? "");
        return (
          <div key={row.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{row.author ?? "Someone"}</span>
                {row.groupName ? ` in ${row.groupName}` : ""}
                {row.ageDays != null ? ` · ${row.ageDays === 0 ? "today" : `${row.ageDays}d ago`}` : ""}
                {row.source === "search" ? " · from search" : ""}
              </span>
              <span className="flex items-center gap-2">
                {row.matched ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">mentions the work</span> : null}
                read {shortWhen(row.createdAt)}
              </span>
            </div>
            <p className="whitespace-pre-wrap text-sm">
              {open || !long ? row.text : `${(row.text ?? "").slice(0, 280)}…`}
              {long && (
                <button
                  type="button"
                  className="ml-1 text-xs underline"
                  onClick={() => setExpanded((s) => {
                    const next = new Set(s);
                    if (next.has(row.id)) next.delete(row.id);
                    else next.add(row.id);
                    return next;
                  })}
                >
                  {open ? "less" : "more"}
                </button>
              )}
            </p>
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
              {row.url ? "Open the post" : "Find it on Facebook"} <ExternalLink className="h-3 w-3" />
            </a>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" disabled={busy !== null} onClick={() => pick(row, "accept")}>
                {busy === row.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PenLine className="mr-1 h-4 w-4" />}
                {busy === row.id ? "Writing…" : "Write a comment"}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => pick(row, "pass")}>
                <X className="mr-1 h-4 w-4" /> Pass
              </Button>
              {errors[row.id] ? <span className="text-xs text-red-700">{errors[row.id]}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

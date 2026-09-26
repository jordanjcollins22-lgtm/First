"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { passAgentPost, setAgentPostKind, sortAgentPosts } from "@/lib/actions/outreach-agent-actions";
import type { SeenRow } from "@/lib/data/outreach-agent";
import { findPostUrl } from "@/lib/outreach-agent";
import { shortWhen } from "@/lib/time-zone";

/**
 * Every post the browser read, sorted, for the owner to check.
 *
 * Three piles. People asking for work come first, and are the ones on the
 * team's Posts to answer board. Other posts are one tap away, in case the
 * sort got one wrong. Adverts have already left: the business behind each
 * one is on the Businesses list. Any post can be moved to another pile,
 * and a move is kept as the owner's word.
 */
type Pile = "request" | "other" | "unsorted";

export function AgentPicker({ rows }: { rows: SeenRow[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [moved, setMoved] = useState<Record<string, "request" | "other">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pile, setPile] = useState<Pile>("request");
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const left = rows.filter((r) => !gone.has(r.id));
  const kindOf = (r: SeenRow): Pile => moved[r.id] ?? (r.kind === "request" ? "request" : r.kind === "other" ? "other" : "unsorted");
  const counts = { request: 0, other: 0, unsorted: 0 };
  for (const r of left) counts[kindOf(r)] += 1;
  const shown = left.filter((r) => kindOf(r) === pile);

  function run(row: SeenRow, what: "pass" | "ad" | "request" | "other") {
    setBusy(`${row.id}:${what}`);
    setErrors((e) => ({ ...e, [row.id]: "" }));
    startTransition(async () => {
      const result =
        what === "pass" ? await passAgentPost(row.id) : await setAgentPostKind({ seenId: row.id, kind: what === "ad" ? "promotion" : what });
      setBusy(null);
      if (!result.ok) {
        setErrors((e) => ({ ...e, [row.id]: result.error }));
        return;
      }
      if (what === "request" || what === "other") setMoved((m) => ({ ...m, [row.id]: what }));
      else setGone((s) => new Set(s).add(row.id));
    });
  }

  function sortNow() {
    setNote(null);
    setBusy("sort");
    startTransition(async () => {
      const result = await sortAgentPosts();
      setBusy(null);
      setNote(result.ok ? `Sorted ${result.sorted ?? 0}. Refresh the page to see them in their piles.` : result.error);
    });
  }

  if (left.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing read yet. Press Look now in the extension and the posts it reads show up here.</p>;
  }

  const tab = (key: Pile, label: string) => (
    <button
      type="button"
      onClick={() => setPile(key)}
      className={`rounded-full border px-3 py-1 text-xs ${pile === key ? "border-foreground bg-foreground text-background" : "border-border"}`}
    >
      {label} ({counts[key]})
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {tab("request", "Asking for work")}
        {tab("other", "Other posts")}
        {counts.unsorted > 0 && tab("unsorted", "Not sorted yet")}
        {counts.unsorted > 0 && (
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={sortNow}>
            {busy === "sort" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Sort them now
          </Button>
        )}
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {pile === "request" ? "Nobody asking for work in what it read. Check the other piles in case the sort missed one." : "Nothing here."}
        </p>
      )}
      {shown.map((row) => {
        const open = expanded.has(row.id);
        const long = (row.text ?? "").length > 280;
        const link = row.url || findPostUrl(row.text ?? "");
        const here = kindOf(row);
        return (
          <div key={row.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{row.author ?? "Someone"}</span>
                {row.groupName ? ` in ${row.groupName}` : ""}
                {row.ageDays != null ? ` · ${row.ageDays === 0 ? "today" : `${row.ageDays}d ago`}` : ""}
                {row.source === "search" ? " · from search" : ""}
              </span>
              <span>read {shortWhen(row.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-sm">
              {open || !long ? row.text : `${(row.text ?? "").slice(0, 280)}…`}
              {long && (
                <button
                  type="button"
                  className="ml-1 text-xs underline"
                  onClick={() =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                >
                  {open ? "less" : "more"}
                </button>
              )}
            </p>
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
              {row.url ? "Open the post" : "Find it on Facebook"} <ExternalLink className="h-3 w-3" />
            </a>
            <div className="flex flex-wrap items-center gap-2">
              {here === "request" && (
                <Link href="/admin/outreach/posts" className="text-xs font-medium underline">
                  Answer it on the board
                </Link>
              )}
              <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => run(row, "pass")}>
                <X className="mr-1 h-4 w-4" /> Pass
              </Button>
              <span className="text-xs text-muted-foreground">Wrong pile?</span>
              <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => run(row, "ad")}>
                {busy === `${row.id}:ad` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                It&apos;s an ad
              </Button>
              {here !== "request" && (
                <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => run(row, "request")}>
                  Asking for work
                </Button>
              )}
              {here !== "other" && (
                <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => run(row, "other")}>
                  Other
                </Button>
              )}
              {errors[row.id] ? <span className="text-xs text-red-700">{errors[row.id]}</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

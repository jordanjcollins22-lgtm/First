"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, PenLine, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { letPostGo, markAnswerPosted, removeFromBoard, takePost } from "@/lib/actions/post-board-actions";
import type { BoardPost } from "@/lib/data/post-board";
import { shortWhen } from "@/lib/time-zone";

/**
 * The Posts to answer board.
 *
 * Every post the browser found of somebody asking for the work. Press
 * "Answer this one" and a comment is written for you, with your own link;
 * copy it, open the post, paste it under the post from your own Facebook,
 * and press "I posted it". A post somebody has taken is held for them for a
 * couple of hours, and one somebody posted under is theirs, so the same
 * neighbour never gets two comments from us.
 */
type Tab = "open" | "mine" | "others";

export function PostBoard({ posts, owner, answeredToday, dailyLimit }: { posts: BoardPost[]; owner: boolean; answeredToday: number; dailyLimit: number }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(posts.some((p) => p.pile === "mine" && p.mine?.status === "written") ? "mine" : "open");
  const [written, setWritten] = useState<Record<string, { answerId: string; comment: string }>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const pileOf = (p: BoardPost): Tab => (written[p.id] || p.pile === "mine" ? "mine" : p.pile === "open" ? "open" : "others");
  const counts = { open: 0, mine: 0, others: 0 };
  for (const p of posts) counts[pileOf(p)] += 1;
  const shown = posts.filter((p) => pileOf(p) === tab);

  function act(post: BoardPost, what: "take" | "posted" | "let-go" | "remove") {
    setBusy(`${post.id}:${what}`);
    setErrors((e) => ({ ...e, [post.id]: "" }));
    startTransition(async () => {
      const answerId = written[post.id]?.answerId ?? post.mine?.id ?? "";
      if (what === "take") {
        const result = await takePost(post.id);
        setBusy(null);
        if (!result.ok) {
          setErrors((e) => ({ ...e, [post.id]: result.error }));
          return;
        }
        setWritten((w) => ({ ...w, [post.id]: { answerId: result.answerId, comment: result.comment } }));
        router.refresh();
        return;
      }
      const result =
        what === "posted" ? await markAnswerPosted(answerId) : what === "let-go" ? await letPostGo(answerId) : await removeFromBoard(post.id);
      setBusy(null);
      if (!result.ok) {
        setErrors((e) => ({ ...e, [post.id]: result.error }));
        return;
      }
      if (what === "let-go") {
        setWritten((w) => {
          const next = { ...w };
          delete next[post.id];
          return next;
        });
      }
      router.refresh();
    });
  }

  // A pasted "@Name" is only text; Facebook tags somebody only when they
  // are picked from the list that typing @ brings up. So the mention is left
  // off what is copied, and the steps say to type it first.
  async function copyAndOpen(post: BoardPost, comment: string) {
    const first = mentionOf(post, comment);
    const body = first ? comment.slice(first.length + 1).trimStart() : comment;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(post.id);
    } catch {
      setErrors((e) => ({ ...e, [post.id]: "Couldn't copy. Press and hold the comment to copy it by hand." }));
    }
    window.open(post.link, "_blank", "noopener");
  }

  const tabButton = (key: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`rounded-full border px-3 py-1 text-xs ${tab === key ? "border-foreground bg-foreground text-background" : "border-border"}`}
    >
      {label} ({counts[key]})
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {tabButton("open", "Waiting for an answer")}
        {tabButton("mine", "Mine")}
        {tabButton("others", "Taken by the team")}
        <span className="text-xs text-muted-foreground">
          You&apos;ve answered {answeredToday} of {dailyLimit} today.
        </span>
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {tab === "open"
            ? "Nothing waiting. New posts land here as the finder reads Facebook."
            : tab === "mine"
              ? "You haven't taken any yet. Pick one from “Waiting for an answer”."
              : "Nobody else has taken any yet."}
        </p>
      )}

      {shown.map((post) => {
        const mine = written[post.id] ?? (post.mine ? { answerId: post.mine.id, comment: post.mine.comment ?? "" } : null);
        const posted = post.mine?.status === "posted";
        const comment = edits[post.id] ?? mine?.comment ?? "";
        const open = expanded.has(post.id);
        const long = post.text.length > 320;
        return (
          <div key={post.id} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span>
                <span className="font-medium text-foreground">{post.author ?? "Someone (anonymous)"}</span>
                {post.groupName ? ` in ${post.groupName}` : ""}
                {` · posted ${post.ageDays === 0 ? "today" : post.ageDays === 1 ? "yesterday" : `${post.ageDays} days ago`}`}
              </span>
              <span>found {shortWhen(post.foundAt)}</span>
            </div>
            <p className="whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">
              {open || !long ? post.text : `${post.text.slice(0, 320)}…`}
              {long && (
                <button
                  type="button"
                  className="ml-1 text-xs underline"
                  onClick={() =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (next.has(post.id)) next.delete(post.id);
                      else next.add(post.id);
                      return next;
                    })
                  }
                >
                  {open ? "less" : "more"}
                </button>
              )}
            </p>
            <a href={post.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
              {post.hasUrl ? "Open the post" : "Find it on Facebook"} <ExternalLink className="h-3 w-3" />
            </a>

            {post.heldBy && (
              <p className="text-xs text-muted-foreground">
                {post.heldBy.status === "posted"
                  ? `${post.heldBy.name} answered this ${shortWhen(post.heldBy.postedAt ?? post.heldBy.updatedAt)}${post.heldBy.clicks > 0 ? ` · ${post.heldBy.clicks} click${post.heldBy.clicks === 1 ? "" : "s"}` : ""}.`
                  : `${post.heldBy.name} is answering this (took it ${shortWhen(post.heldBy.updatedAt)}).`}
                {pileOf(post) === "mine" && post.heldBy.status === "posted" && !posted ? " Probably best to hand yours back." : ""}
              </p>
            )}

            {mine ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {posted ? "Your comment, posted" : "Your comment, with your link"}
                </p>
                <Textarea value={comment} rows={6} readOnly={posted} onChange={(e) => setEdits((d) => ({ ...d, [post.id]: e.target.value }))} />
                {posted ? (
                  <p className="text-xs text-emerald-700">
                    Posted{post.mine?.postedAt ? ` ${shortWhen(post.mine.postedAt)}` : ""}
                    {post.mine && post.mine.clicks > 0 ? ` · ${post.mine.clicks} click${post.mine.clicks === 1 ? "" : "s"} on your link` : ""}.
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" size="sm" onClick={() => copyAndOpen(post, comment)}>
                        <Copy className="mr-1 h-4 w-4" /> Copy &amp; open the post
                      </Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => act(post, "posted")}>
                        {busy === `${post.id}:posted` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Check className="mr-1 h-4 w-4" />}
                        I posted it
                      </Button>
                      <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(post, "let-go")}>
                        <Undo2 className="mr-1 h-4 w-4" /> Hand it back
                      </Button>
                    </div>
                    {copied === post.id && (
                      <p className="text-xs text-muted-foreground">
                        Copied.{" "}
                        {mentionOf(post, comment)
                          ? `In the comment box type @${mentionOf(post, comment)} and pick them from the list so they're tagged, then paste after it and send.`
                          : "In the comment box, paste and send."}{" "}
                        Then come back and press &ldquo;I posted it&rdquo;.
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : post.pile === "open" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={busy !== null} onClick={() => act(post, "take")}>
                  {busy === `${post.id}:take` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PenLine className="mr-1 h-4 w-4" />}
                  {busy === `${post.id}:take` ? "Writing yours…" : "Answer this one"}
                </Button>
                {owner && (
                  <Button type="button" size="sm" variant="ghost" disabled={busy !== null} onClick={() => act(post, "remove")}>
                    <X className="mr-1 h-4 w-4" /> Not a lead, take it off
                  </Button>
                )}
              </div>
            ) : null}
            {errors[post.id] ? <p className="text-xs text-red-700">{errors[post.id]}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

/** The first name the comment opens by tagging, when it does. */
function mentionOf(post: BoardPost, comment: string): string | null {
  const first = post.author?.trim().split(/\s+/)[0];
  if (!first) return null;
  return comment.startsWith(`@${first}`) ? first : null;
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, ExternalLink, Loader2, PenLine, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { letPostGo, markAnswerPosted, removeFromBoard, takePost } from "@/lib/actions/post-board-actions";
import type { BoardPost } from "@/lib/data/post-board";
import { shortWhen } from "@/lib/time-zone";
import { PLATFORM_LABEL } from "@/lib/social-finder";

/**
 * The Posts to answer board.
 *
 * Every post the browser found of somebody asking for the work. Press
 * "Answer this one" and a comment is written for you, with your own link;
 * copy it, open the post, paste it under the post from your own Facebook,
 * and press "I posted it". Two people may answer each post: a place is held
 * for a couple of hours while somebody writes, and for good once they post, so the same
 * neighbour never gets more than two comments from us. The owner can
 * always add theirs.
 */
type Tab = "open" | "mine" | "full";

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

  const pileOf = (p: BoardPost): Tab => (written[p.id] || p.pile === "mine" ? "mine" : p.pile);
  const counts = { open: 0, mine: 0, full: 0 };
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
    if (post.hasUrl) window.open(post.link, "_blank", "noopener");
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
        {tabButton("full", "Two answers already")}
        <span className="text-xs text-muted-foreground">
          {owner ? `You've answered ${answeredToday} today.` : `You've answered ${answeredToday} of ${dailyLimit} today.`}
        </span>
      </div>

      {shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {tab === "open"
            ? "Nothing waiting. New posts land here as the finder reads Facebook."
            : tab === "mine"
              ? "You haven't taken any yet. Pick one from “Waiting for an answer”."
              : "No post has two answers yet."}
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
                <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
                  {PLATFORM_LABEL[post.platform] ?? "Facebook"}
                </span>
                <span className="font-medium text-foreground">{post.author ?? "Someone (anonymous)"}</span>
                {post.groupName ? ` in ${post.groupName}` : ""}
                {` · posted ${post.postedAt ? shortWhen(post.postedAt) : post.ageDays === 0 ? "today" : post.ageDays === 1 ? "yesterday" : `${post.ageDays} days ago`}`}
              </span>
              <span>found {shortWhen(post.foundAt)}</span>
            </div>
            {/* Why the finder kept it, so a post that does not belong is easy
                to spot and the words can be tuned. */}
            {post.matchReason && <p className="text-[11px] text-muted-foreground">Why it&apos;s here: {post.matchReason}</p>}
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
            {/* Only a link that opens the post. A search for its words almost
                never found it, so a post without one shows no link at all. */}
            {post.hasUrl && (
              <a href={post.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline">
                Open the post <ExternalLink className="h-3 w-3" />
              </a>
            )}

            {post.others.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {post.others.map((a) => describeAnswer(a)).join(" ")}
                {pileOf(post) === "open" ? " There's room for one more." : ""}
                {pileOf(post) === "full" && owner ? " You can still add yours." : ""}
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
                        <Copy className="mr-1 h-4 w-4" /> {post.hasUrl ? <>Copy &amp; open the post</> : "Copy comment"}
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
            ) : post.pile === "open" || owner ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={busy !== null} onClick={() => act(post, "take")}>
                  {busy === `${post.id}:take` ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PenLine className="mr-1 h-4 w-4" />}
                  {busy === `${post.id}:take` ? "Writing yours…" : post.others.length > 0 ? "Answer it too" : "Answer this one"}
                </Button>
                {owner && post.pile === "open" && (
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

/** "Jace answered this Thu 2:10 PM · 3 clicks." or "Jace is answering this (took it 1:05 PM)." */
function describeAnswer(a: BoardPost["others"][number]): string {
  if (a.status === "posted") {
    const clicks = a.clicks > 0 ? ` · ${a.clicks} click${a.clicks === 1 ? "" : "s"}` : "";
    return `${a.name} answered this ${shortWhen(a.postedAt ?? a.updatedAt)}${clicks}.`;
  }
  return `${a.name} is answering this (took it ${shortWhen(a.updatedAt)}).`;
}

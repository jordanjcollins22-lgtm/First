"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { copyNow, writeClipboard } from "@/lib/clipboard";
import { isAnswered } from "@/lib/post-board";
import type { BoardPost } from "@/lib/data/post-board";

/**
 * Right under the card: the posts this person answered lately, each with what
 * they wrote, to copy again and a way back to the post. For the tab closed
 * by accident after Copy & go to post, with the comment never pasted.
 */
export function RecentAnswers({ posts }: { posts: BoardPost[] }) {
  const answered = posts
    .filter((p) => p.mine && isAnswered(p.mine.status) && p.mine.comment)
    .sort((a, b) => (b.mine!.postedAt ?? b.mine!.updatedAt).localeCompare(a.mine!.postedAt ?? a.mine!.updatedAt));
  if (answered.length === 0) return null;
  return (
    <section className="mx-auto w-full max-w-md rounded-2xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Your recent answers</h2>
      <p className="mb-2 text-xs text-muted-foreground">Clicked off before you pasted? Copy the comment again and go back to the post.</p>
      <ul className="flex flex-col divide-y divide-border/60">
        {answered.map((p) => (
          <Answer key={p.id} post={p} />
        ))}
      </ul>
    </section>
  );
}

function Answer({ post }: { post: BoardPost }) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);
  const comment = post.mine!.comment!;

  async function copy() {
    const ok = copyNow(comment) || (await writeClipboard(comment));
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2500);
  }

  return (
    <li className="py-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full text-left">
        <p className="text-xs text-muted-foreground">
          {[post.author, post.groupName].filter(Boolean).join(" · ") || "A post"}
        </p>
        <p className="line-clamp-2 text-sm">{post.text}</p>
      </button>
      {open && <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-sm">{comment}</p>}
      <div className="mt-1.5 grid grid-cols-2 gap-2">
        <button type="button" onClick={copy} className="flex h-10 items-center justify-center gap-1 rounded-md border border-border text-sm font-medium">
          {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copied" : "Copy comment"}
        </button>
        <a href={post.link} target="_blank" rel="noreferrer" className="flex h-10 items-center justify-center gap-1 rounded-md bg-primary text-sm font-semibold text-primary-foreground">
          Open the post <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    </li>
  );
}

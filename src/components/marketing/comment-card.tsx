"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Copy, ExternalLink, ImagePlus, Loader2, MessageSquareReply, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { letPostGo, markAnswerPosted, markCantRespond, submitFoundPost, takePost } from "@/lib/actions/post-board-actions";
import { CANT_RESPOND_REASONS, type CantRespondReason } from "@/lib/post-board";
import { createShotUpload } from "@/lib/actions/outreach-link-actions";
import { createClient } from "@/lib/supabase/client";
import { hashBytes } from "@/lib/screenshot-hash";
import { shrinkImage } from "@/lib/shrink-image";
import { PLATFORM_LABEL } from "@/lib/social-finder";
import { shortWhen } from "@/lib/time-zone";
import type { BoardPost } from "@/lib/data/post-board";

/**
 * The comment card: one post at a time, and everything needed for it.
 *
 * The next post this person can answer, with three choices: it isn't a job
 * post, it's an ad, or respond. Respond writes their comment with their own
 * link; "Copy & go to post" copies it, opens the post and marks it answered,
 * and the next post takes its place. Underneath, "Found a post?" takes a
 * link, a screenshot or both, says if it is already in, and if it is new
 * puts it on the card next.
 */

/** The post the card shows: one pinned by adding it, then one they took, then the newest open one. */
function nextPost(posts: BoardPost[], pinned: string | null, skipped: Set<string>): BoardPost | null {
  if (pinned) {
    const post = posts.find((p) => p.id === pinned);
    if (post && (post.pile === "open" || post.pile === "mine")) return post;
  }
  const taken = posts.find((p) => p.pile === "mine" && p.mine?.status === "written" && !skipped.has(p.id));
  if (taken) return taken;
  return posts.find((p) => p.pile === "open" && !skipped.has(p.id)) ?? null;
}

function mentionOf(post: BoardPost, comment: string): string | null {
  const first = post.author?.trim().split(/\s+/)[0];
  if (!first) return null;
  return comment.startsWith(`@${first}`) ? first : null;
}


const FRESHNESS_STYLE: Record<BoardPost["freshness"], string> = {
  fresh: "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200",
  aging: "bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200",
  old: "bg-orange-50 text-orange-900 dark:bg-orange-500/15 dark:text-orange-200",
  unknown: "bg-muted text-muted-foreground",
};

export function CommentCard({
  posts,
  pinned: pinnedAtLoad,
  answeredToday,
  dailyLimit,
  owner,
}: {
  posts: BoardPost[];
  pinned: string | null;
  answeredToday: number;
  dailyLimit: number;
  owner: boolean;
}) {
  const router = useRouter();
  const [pinned, setPinned] = useState<string | null>(pinnedAtLoad);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [written, setWritten] = useState<Record<string, { answerId: string; comment: string }>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedTip, setCopiedTip] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [otherNote, setOtherNote] = useState("");
  const [, startTransition] = useTransition();

  const post = useMemo(() => nextPost(posts, pinned, skipped), [posts, pinned, skipped]);
  const waiting = posts.filter((p) => p.pile === "open").length;
  const mine = post ? (written[post.id] ?? (post.mine?.comment ? { answerId: post.mine.id, comment: post.mine.comment } : null)) : null;
  const comment = post ? (edits[post.id] ?? mine?.comment ?? "") : "";

  function done() {
    setPinned(null);
    setCopiedTip(null);
    setAsking(false);
    setOtherNote("");
    router.refresh();
  }

  function cantRespond(reason: CantRespondReason) {
    if (!post) return;
    if (reason === "other" && !otherNote.trim()) {
      setError("Say what it was, in a few words.");
      return;
    }
    setError(null);
    setBusy(reason);
    startTransition(async () => {
      const result = await markCantRespond(post.id, reason, reason === "other" ? otherNote : undefined);
      setBusy(null);
      if (!result.ok) return setError(result.error);
      done();
    });
  }

  function run(what: "respond" | "hand-back") {
    if (!post) return;
    setError(null);
    setBusy(what);
    startTransition(async () => {
      if (what === "respond") {
        const result = await takePost(post.id);
        setBusy(null);
        if (!result.ok) return setError(result.error);
        setWritten((w) => ({ ...w, [post.id]: { answerId: result.answerId, comment: result.comment } }));
        return;
      }
      const result = await letPostGo(mine?.answerId ?? "");
      setBusy(null);
      if (!result.ok) return setError(result.error);
      setSkipped((s) => new Set(s).add(post.id));
      done();
    });
  }

  async function copyAndGo() {
    if (!post || !mine) return;
    setError(null);
    const first = mentionOf(post, comment);
    const body = first ? comment.slice(first.length + 1).trimStart() : comment;
    try {
      await navigator.clipboard.writeText(body);
    } catch {
      setError("Couldn't copy. Press and hold the comment to copy it by hand.");
      return;
    }
    if (post.hasUrl) window.open(post.link, "_blank", "noopener");
    setCopiedTip(first ? `Copied. Type @${first}, pick them from the list, then paste.` : "Copied. Paste it under the post.");
    setBusy("posted");
    const result = await markAnswerPosted(mine.answerId);
    setBusy(null);
    if (!result.ok) return setError(result.error);
    // A moment to read the tip before the next post takes this one's place.
    setTimeout(done, 2500);
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="flex min-h-[26rem] flex-col rounded-2xl border border-border bg-card p-4 shadow-lg shadow-black/5">
        <div className="mb-3 flex items-baseline justify-between text-xs text-muted-foreground">
          <span>{waiting} waiting</span>
          <span>{owner ? `You've answered ${answeredToday} today` : `${answeredToday} of ${dailyLimit} today`}</span>
        </div>

        {!post ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p className="text-base font-semibold">Nothing to answer right now.</p>
            <p className="mt-1 text-sm text-muted-foreground">New posts land here as they&apos;re found. Found one yourself? Add it below.</p>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3">
            <div className="text-xs text-muted-foreground">
              <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground">
                {PLATFORM_LABEL[post.platform] ?? "Facebook"}
              </span>
              <span className="font-medium text-foreground">{post.author ?? "Someone"}</span>
              {post.groupName ? ` in ${post.groupName}` : ""}
            </div>
            {/* When it went up, said plainly, and what that means for answering it. */}
            <div className={`rounded-lg px-3 py-2 text-xs ${FRESHNESS_STYLE[post.freshness]}`}>
              <p className="font-semibold">
                {post.ageLabel}
                {post.postedAt ? <span className="font-normal opacity-80"> · {shortWhen(post.postedAt)}</span> : null}
              </p>
              <p className="opacity-90">{post.ageHint}</p>
            </div>
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-sm">{post.text}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>{post.matchReason ? `Why it's here: ${post.matchReason}` : ""}</span>
              {post.hasUrl && (
                <a href={post.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                  Open the post <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            {post.others.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                {post.others.map((a) => `${a.name} ${a.status === "posted" ? "answered it" : "is answering it"}`).join(" · ")}. Room for yours.
              </p>
            )}

            {!mine && asking ? (
              <div className="mt-auto space-y-2">
                <p className="text-sm font-semibold">Why can&apos;t you respond?</p>
                <div className="grid grid-cols-2 gap-2">
                  {CANT_RESPOND_REASONS.filter((r) => r.key !== "other").map((r) => (
                    <Button
                      key={r.key}
                      type="button"
                      variant="outline"
                      disabled={busy !== null}
                      onClick={() => cantRespond(r.key)}
                      className="h-auto whitespace-normal py-2 text-xs"
                    >
                      {busy === r.key ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                      {r.label}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input value={otherNote} placeholder="Something else? Say what" onChange={(e) => setOtherNote(e.target.value)} className="h-9" />
                  <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => cantRespond("other")}>
                    {busy === "other" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                  </Button>
                </div>
                <button type="button" onClick={() => setAsking(false)} className="mx-auto block text-[11px] text-muted-foreground underline">
                  Back
                </button>
              </div>
            ) : !mine ? (
              <div className="mt-auto grid grid-cols-2 gap-2">
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => { setError(null); setAsking(true); }} className="h-auto flex-col gap-1 py-3 text-sm">
                  <Ban className="h-5 w-5" />
                  Can&apos;t respond
                </Button>
                <Button type="button" disabled={busy !== null} onClick={() => run("respond")} className="h-auto flex-col gap-1 py-3 text-sm">
                  {busy === "respond" ? <Loader2 className="h-5 w-5 animate-spin" /> : <MessageSquareReply className="h-5 w-5" />}
                  {busy === "respond" ? "Writing…" : "Respond"}
                </Button>
              </div>
            ) : (
              <div className="mt-auto space-y-2">
                <Textarea value={comment} rows={6} onChange={(e) => setEdits((d) => ({ ...d, [post.id]: e.target.value }))} />
                <Button type="button" className="w-full" disabled={busy !== null} onClick={copyAndGo}>
                  {busy === "posted" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Copy className="mr-1 h-4 w-4" />}
                  {post.hasUrl ? "Copy & go to post" : "Copy comment"}
                </Button>
                {copiedTip && <p className="text-center text-xs text-emerald-700">{copiedTip}</p>}
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => run("hand-back")}
                  className="mx-auto flex items-center gap-1 text-[11px] text-muted-foreground underline"
                >
                  <Undo2 className="h-3 w-3" /> Hand it back
                </button>
              </div>
            )}

          </div>
        )}
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

        <FoundAPost
          onAdded={(seenId) => {
            setPinned(seenId);
            setSkipped((s) => {
              const next = new Set(s);
              next.delete(seenId);
              return next;
            });
            router.refresh();
          }}
        />
      </div>
    </div>
  );
}

/** Found a post? A link, a screenshot, or both. */
function FoundAPost({ onAdded }: { onAdded: (seenId: string) => void }) {
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; tone: "good" | "info" | "bad" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit() {
    setResult(null);
    if (!link.trim() && !file) return setResult({ text: "Paste the post's link or add a screenshot.", tone: "bad" });
    setBusy(true);
    try {
      let screenshotPath: string | null = null;
      let screenshotHash: string | null = null;
      if (file) {
        screenshotHash = await hashBytes(await file.arrayBuffer()).catch(() => null);
        const small = await shrinkImage(file).catch(() => file);
        const slot = await createShotUpload({ fileType: small.type, fileSize: small.size, hash: screenshotHash });
        if (!slot.ok) return setResult({ text: slot.error, tone: /already/i.test(slot.error) ? "info" : "bad" });
        const sent = await createClient().storage.from("recommendation-shots").uploadToSignedUrl(slot.path, slot.token, small, { contentType: small.type });
        if (sent.error) return setResult({ text: "That screenshot wouldn't upload. Try a smaller one.", tone: "bad" });
        screenshotPath = slot.path;
      }
      const res = await submitFoundPost({ url: link, screenshotPath, screenshotHash });
      if (!res.ok) return setResult({ text: res.error, tone: "bad" });
      setResult({ text: res.message, tone: res.status === "added" ? "good" : "info" });
      if (res.seenId && (res.status === "added" || res.canAnswer)) onAdded(res.seenId);
      if (res.status === "added") {
        setLink("");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 space-y-2 border-t border-border pt-3">
      <p className="text-sm font-semibold">Found a post?</p>
      <Input
        type="url"
        inputMode="url"
        placeholder="Paste the link (Share → Copy link)"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        className="h-9"
      />
      <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent">
          <ImagePlus className="h-4 w-4" />
          {file ? "Screenshot added" : "Add screenshot"}
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button type="button" size="sm" className="ml-auto" disabled={busy} onClick={submit}>
          {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {busy ? "Checking…" : "Add it"}
        </Button>
      </div>
      {result && (
        <p className={`text-xs ${result.tone === "good" ? "text-emerald-700" : result.tone === "bad" ? "text-destructive" : "text-muted-foreground"}`}>
          {result.text}
        </p>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Undo2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { approvePlanPost, savePlanPost, skipPlanPost, unapprovePlanPost, type PlanResult } from "@/lib/actions/social-plan-actions";
import { PLAN_KIND_LABEL, cleanHashtags, composePlanCaption, planProblems } from "@/lib/social-plan";
import type { PlanPost } from "@/lib/data/social-plan";

const dayName = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * This week's posts, one a day, each with its picture, hook, main text,
 * call to action and hashtags, all editable. Approve and it goes out on its
 * day; nothing is posted without that.
 */
export function WeekPlan({ posts, publishesTo }: { posts: PlanPost[]; publishesTo: string[] }) {
  const waiting = posts.filter((p) => p.status === "draft").length;
  return (
    <section className="mx-auto mb-8 max-w-3xl px-4 pt-4 sm:pt-6">
      <h2 className="text-xl font-bold">This week&apos;s posts</h2>
      <p className="text-sm text-muted-foreground">
        {posts.length === 0
          ? "No posts planned for this week yet."
          : waiting > 0
            ? `${waiting} waiting for your approval. Change anything you like, then approve. Each one carries its own tracked link, so we can see which post books work.`
            : "All approved. Each one goes out on its day."}
      </p>
      {posts.length > 0 && publishesTo.length === 0 && (
        <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Facebook and Instagram aren&apos;t connected yet, so approved posts wait here until the Meta keys are added. You can still copy one and post it by hand.
        </p>
      )}
      <div className="mt-4 flex flex-col gap-6">
        {posts.map((p) => (
          <PlanCard key={`${p.id}:${p.status}`} post={p} />
        ))}
      </div>
    </section>
  );
}

function PlanCard({ post }: { post: PlanPost }) {
  const [hook, setHook] = useState(post.hook);
  const [body, setBody] = useState(post.body);
  const [cta, setCta] = useState(post.cta);
  const [tags, setTags] = useState(post.hashtags.join(" "));
  const [result, setResult] = useState<PlanResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();
  const text = { hook, body, cta, hashtags: tags.split(/[\s,]+/).filter(Boolean) };
  const problems = planProblems(text);
  const approved = post.status === "scheduled";
  const posted = post.status === "posted";
  const act = (fn: () => Promise<PlanResult>) => start(async () => setResult(await fn()));

  async function copy() {
    try {
      await navigator.clipboard.writeText(composePlanCaption(text, post.link));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setResult({ ok: false, message: "Couldn't copy. Select the text and copy it." });
    }
  }

  return (
    <article className="overflow-hidden rounded-xl border bg-card/70">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{dayName(post.day)}</span>
          {post.kind && <Badge variant="outline">{PLAN_KIND_LABEL[post.kind]}</Badge>}
        </div>
        <Badge variant={posted ? "default" : approved ? "secondary" : "outline"}>
          {posted ? "Posted" : approved ? "Approved" : "Waiting for you"}
        </Badge>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[240px_1fr]">
        <a href={post.imageUrl} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn by the app's own picture route */}
          <img src={post.imageUrl} alt={`Picture for ${dayName(post.day)}`} className="w-full rounded-lg border" loading="lazy" />
        </a>
        <div className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Hook (first line, stops the scroll)</span>
            <Input value={hook} onChange={(e) => setHook(e.target.value)} disabled={posted} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Main text</span>
            <Textarea rows={Math.min(10, Math.max(3, body.split("\n").length + 1))} value={body} onChange={(e) => setBody(e.target.value)} disabled={posted} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Call to action ({"{link}"} becomes the tracked link)</span>
            <Input value={cta} onChange={(e) => setCta(e.target.value)} disabled={posted} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted-foreground">Hashtags (3 to 5: service and town)</span>
            <Input value={tags} onChange={(e) => setTags(e.target.value)} disabled={posted} />
            <span className="text-xs text-muted-foreground">{cleanHashtags(text.hashtags).join(" ")}</span>
          </label>
          {post.link && (
            <p className="text-xs text-muted-foreground">
              Tracked link: {post.link} · {post.clicks} {post.clicks === 1 ? "click" : "clicks"}
            </p>
          )}
          {problems.length > 0 && !posted && <p className="text-xs text-destructive">{problems.join(" ")}</p>}
          {!posted && (
            <div className="flex flex-wrap gap-2">
              {!approved && (
                <Button disabled={pending || problems.length > 0} onClick={() => act(() => approvePlanPost(post.id, text))}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Approve
                </Button>
              )}
              <Button variant="outline" disabled={pending} onClick={() => act(() => savePlanPost(post.id, text))}>
                Save changes
              </Button>
              <Button variant="outline" onClick={copy}>
                {copied ? "Copied" : "Copy caption"}
              </Button>
              {approved && (
                <Button variant="ghost" disabled={pending} onClick={() => act(() => unapprovePlanPost(post.id))}>
                  <Undo2 className="h-4 w-4" /> Undo approval
                </Button>
              )}
              <Button variant="ghost" disabled={pending} onClick={() => act(() => skipPlanPost(post.id))}>
                <X className="h-4 w-4" /> Skip
              </Button>
            </div>
          )}
          {result && <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-destructive"}`}>{result.message}</p>}
        </div>
      </div>
    </article>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Ban, Check, Loader2, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { approveQueuedPost, saveQueuedPost } from "@/lib/actions/social-backlog-actions";
import { denyPlanPost, undoDenyPlanPost } from "@/lib/actions/social-plan-actions";
import { draftCaption, draftProblems } from "@/lib/social/photo-drafts";
import { PLATFORM_LABEL, type SocialPlatform } from "@/lib/social/cadence";
import { shortWhen } from "@/lib/time-zone";
import type { QueueItem } from "@/lib/data/social-photo-drafts";

type Result = { ok: boolean; message: string };

/** What the buttons do: the server's, or a demo's that changes nothing real. */
export interface QueueActions {
  approve: (id: string, text: { hook: string; body: string }) => Promise<Result>;
  deny: (id: string) => Promise<Result>;
  undoDeny: (id: string) => Promise<Result>;
  save: (id: string, text: { hook: string; body: string }) => Promise<Result>;
}

const SERVER_ACTIONS: QueueActions = {
  approve: approveQueuedPost,
  deny: (id) => denyPlanPost(id),
  undoDeny: undoDenyPlanPost,
  save: saveQueuedPost,
};

/**
 * Every draft waiting for a yes, in one place: uploaded photos, crew photos
 * from finished jobs, starter posts. Each shows its picture, its caption
 * (the hook and main text can be changed), the accounts, the suggested time
 * and where it came from, with Approve and Deny. Nothing is posted until
 * Approve; Deny keeps it off for good (Undo puts it back).
 */
export function ReadyToApprove({
  items,
  publishesTo,
  actions = SERVER_ACTIONS,
  idPrefix,
  numberOf,
}: {
  items: QueueItem[];
  publishesTo: string[];
  /** For a demo: every button runs these instead. */
  actions?: QueueActions;
  /** Ids on each card and its buttons: {idPrefix}draft-N, {idPrefix}approve-N, {idPrefix}deny-N. */
  idPrefix?: string;
  numberOf?: (item: QueueItem) => number;
}) {
  return (
    <section id={idPrefix ? `${idPrefix}ready-to-approve` : "ready-to-approve"} className="mx-auto mb-8 max-w-3xl px-4 pt-4 sm:pt-6">
      <h2 className="text-2xl font-bold">Ready to approve ({items.length})</h2>
      <p className="text-sm text-muted-foreground">
        {items.length === 0
          ? "Nothing waiting. Upload photos below, or finish a job with crew photos, and the posts show up here."
          : "Made from your uploaded photos and the crew's job photos. Fix the caption if you like, then Approve and it goes out at its time. Nothing posts without your yes."}
      </p>
      {items.length > 0 && publishesTo.length === 0 && (
        <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Facebook and Instagram aren&apos;t connected yet, so approved posts wait until the Meta keys are added (Admin › Facebook &amp; Instagram).
        </p>
      )}
      <div className="mt-4 flex flex-col gap-6">
        {items.map((item, i) => (
          <QueueCard key={item.id} item={item} actions={actions} ids={idPrefix ? { prefix: idPrefix, n: numberOf?.(item) ?? i + 1 } : null} />
        ))}
      </div>
    </section>
  );
}

function QueueCard({ item, actions, ids }: { item: QueueItem; actions: QueueActions; ids: { prefix: string; n: number } | null }) {
  const [hook, setHook] = useState(item.hook);
  const [body, setBody] = useState(item.body);
  const [result, setResult] = useState<Result | null>(null);
  const [state, setState] = useState<"waiting" | "approved" | "denied">("waiting");
  const [pending, start] = useTransition();
  const router = useRouter();
  const text = { hook, body, cta: item.cta, hashtags: item.hashtags };
  const problems = draftProblems(text);
  const edited = hook !== item.hook || body !== item.body;

  const act = (fn: () => Promise<Result>, after?: (r: Result) => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) after?.(r);
    });

  return (
    <article id={ids ? `${ids.prefix}draft-${ids.n}` : undefined} className="overflow-hidden rounded-xl border bg-card/70" data-post={item.id}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{item.source}</Badge>
          {item.platforms.map((p) => (
            <Badge key={p} variant="outline">
              {PLATFORM_LABEL[p as SocialPlatform] ?? p}
            </Badge>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{item.suggestedFor ? `Suggested: ${shortWhen(item.suggestedFor)}` : "Next free slot"}</span>
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-[240px_1fr]">
        <a href={item.imageUrl} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn by the app's own picture route */}
          <img src={item.imageUrl} alt={`Picture for: ${item.hook}`} className="w-full rounded-lg border" loading="lazy" />
        </a>
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            First line
            <Input value={hook} onChange={(e) => setHook(e.target.value)} disabled={state !== "waiting"} />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Caption
            <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} disabled={state !== "waiting"} />
          </label>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Full caption as it will post</summary>
            <p className="mt-1 whitespace-pre-line">{draftCaption(text)}</p>
          </details>
          {item.photoHint && <p className="text-xs text-muted-foreground">Photo: {item.photoHint}</p>}
          {problems.length > 0 && <p className="text-xs text-red-700">{problems.join(" ")}</p>}

          {state === "waiting" ? (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <Button
                id={ids ? `${ids.prefix}approve-${ids.n}` : undefined}
                size="lg"
                disabled={pending || problems.length > 0}
                onClick={() => act(() => actions.approve(item.id, { hook, body }), () => setState("approved"))}
              >
                {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />} Approve
              </Button>
              <Button
                id={ids ? `${ids.prefix}deny-${ids.n}` : undefined}
                size="lg"
                variant="destructive"
                disabled={pending}
                onClick={() => act(() => actions.deny(item.id), () => setState("denied"))}
              >
                <Ban className="h-5 w-5" /> Deny
              </Button>
              {edited && (
                <Button size="sm" variant="outline" className="col-span-2" disabled={pending} onClick={() => act(() => actions.save(item.id, { hook, body }))}>
                  Save caption without approving
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-3">
              <Badge variant={state === "approved" ? "default" : "destructive"}>{state === "approved" ? "Approved" : "Denied"}</Badge>
              {state === "denied" && (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => actions.undoDeny(item.id), () => setState("waiting"))}>
                  <Undo2 className="h-4 w-4" /> Undo
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => router.refresh()}>
                Done
              </Button>
            </div>
          )}
          {result && <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.message}</p>}
        </div>
      </div>
    </article>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadStarterDrafts, retrySocialPost, saveSocialCadence, type AutopostResult } from "@/lib/actions/social-autopost-actions";
import { MAX_PER_WEEK, cadenceProblems, slotLabel, tidyCadence, type CadenceSlot, type SocialCadence } from "@/lib/social/cadence";
import type { Health } from "@/lib/social/autopost";
import type { UpcomingPost } from "@/lib/data/social-autopost";
import { CadenceSummary, PostingHealthCard, UpcomingList } from "@/components/marketing/social-autopost-status";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Automatic posting on Admin › Social: whether it works (last posted, next
 * post, failing because…), the cadence, the queue, and the starter drafts.
 */
export function SocialAutopostPanel(props: { health: Health; cadence: SocialCadence; cadenceReady: boolean; upcoming: UpcomingPost[]; canManage: boolean; seedCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<AutopostResult | null>(null);

  const run = (fn: () => Promise<AutopostResult>) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      router.refresh();
    });

  return (
    <section className="mx-auto max-w-3xl space-y-4 px-4 pt-4 sm:pt-6">
      <h2 className="text-xl font-bold">Automatic posting</h2>
      <PostingHealthCard id="sp-status" health={props.health} />

      {result && <p className={`text-sm ${result.ok ? "text-emerald-700" : "text-red-700"}`}>{result.message}</p>}

      <div id="sp-cadence" className="space-y-3 rounded-lg border border-border p-4">
        <h3 className="font-semibold">How often</h3>
        {props.canManage && props.cadenceReady ? (
          <CadenceForm cadence={props.cadence} pending={pending} onSave={(c) => run(() => saveSocialCadence(c))} />
        ) : (
          <>
            <CadenceSummary cadence={props.cadence} />
            {!props.cadenceReady && <p className="text-xs text-muted-foreground">These are the defaults. Saving a change needs migration 0374_social_autopost.sql.</p>}
          </>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">Queue</h3>
          {props.canManage && (
            <Button variant="outline" size="sm" disabled={pending} onClick={() => run(loadStarterDrafts)}>
              Load the {props.seedCount} starter posts as drafts
            </Button>
          )}
        </div>
        <UpcomingList
          posts={props.upcoming}
          actions={(p) =>
            props.canManage && p.status === "failed" ? (
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => retrySocialPost(p.id))}>
                Try again
              </Button>
            ) : null
          }
        />
      </div>
    </section>
  );
}

function CadenceForm({ cadence, pending, onSave }: { cadence: SocialCadence; pending: boolean; onSave: (c: { facebookPerWeek: number; instagramPerWeek: number; slots: CadenceSlot[]; autofill: boolean }) => void }) {
  const [fb, setFb] = useState(String(cadence.perWeek.facebook));
  const [ig, setIg] = useState(String(cadence.perWeek.instagram));
  const [slots, setSlots] = useState<CadenceSlot[]>(cadence.slots);
  const [autofill, setAutofill] = useState(cadence.autofill);
  const draft = tidyCadence({ facebook_per_week: fb, instagram_per_week: ig, slots, autofill });
  const problems = cadenceProblems(draft);
  const move = (i: number, d: -1 | 1) =>
    setSlots((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-4">
        <label className="space-y-1">
          <span className="block font-medium">Facebook posts a week</span>
          <Input type="number" min={0} max={MAX_PER_WEEK} value={fb} onChange={(e) => setFb(e.target.value)} className="w-24" />
        </label>
        <label className="space-y-1">
          <span className="block font-medium">Instagram posts a week</span>
          <Input type="number" min={0} max={MAX_PER_WEEK} value={ig} onChange={(e) => setIg(e.target.value)} className="w-24" />
        </label>
      </div>
      <div>
        <p className="font-medium">Best times, best first (Eastern)</p>
        <p className="text-xs text-muted-foreground">With 4 a week, each account uses the top 4 times every week.</p>
        <ol className="mt-2 space-y-1.5">
          {slots.map((slot, i) => (
            <li key={`${i}:${slot.weekday}:${slot.hour}`} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}.</span>
              <select
                className="rounded-md border border-border bg-background px-2 py-1"
                value={slot.weekday}
                onChange={(e) => setSlots((s) => s.map((x, k) => (k === i ? { ...x, weekday: Number(e.target.value) } : x)))}
              >
                {DAYS.map((d, k) => (
                  <option key={d} value={k}>
                    {d}
                  </option>
                ))}
              </select>
              <select
                className="rounded-md border border-border bg-background px-2 py-1"
                value={slot.hour}
                onChange={(e) => setSlots((s) => s.map((x, k) => (k === i ? { ...x, hour: Number(e.target.value) } : x)))}
              >
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {slotLabel({ weekday: 0, hour: h }).replace(/^Sun /, "")}
                  </option>
                ))}
              </select>
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                ↑
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={i === slots.length - 1} aria-label="Move down">
                ↓
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setSlots((s) => s.filter((_, k) => k !== i))} aria-label="Remove">
                <X className="size-4" />
              </Button>
            </li>
          ))}
        </ol>
        {slots.length < MAX_PER_WEEK && (
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => setSlots((s) => [...s, { weekday: 1, hour: 12 }])}>
            <Plus className="size-4" /> Add a time
          </Button>
        )}
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={autofill} onChange={(e) => setAutofill(e.target.checked)} />
        Give approved posts the next free slot by themselves
      </label>
      {problems.length > 0 && <p className="text-xs text-red-700">{problems.join(" ")}</p>}
      <Button
        disabled={pending || problems.length > 0}
        onClick={() => onSave({ facebookPerWeek: draft.perWeek.facebook, instagramPerWeek: draft.perWeek.instagram, slots: draft.slots, autofill: draft.autofill })}
      >
        {pending ? "Saving…" : "Save cadence"}
      </Button>
    </div>
  );
}

"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Copy, Loader2, Timer, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { countMission, dropMission, startMission } from "@/lib/actions/mission-actions";
import type { MyMissions } from "@/lib/data/missions";
import { MISSION_CATEGORIES, categoryFor, elapsed, missionFor } from "@/lib/missions";

/**
 * The mission board. Pick a category, get a mission from it with a number to
 * hit, the steps and the words, and count your way there against the clock.
 */
export function MissionBoard({ missions, first, link }: { missions: MyMissions; first: string; link: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.message ?? "Something went wrong.");
    });
  };

  if (!missions.ready) {
    return <p className="mt-3 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">The mission board is on its way. Ask the office to switch it on.</p>;
  }

  const doneBy = (key: string) => missions.done.filter((d) => d.category === key).length;

  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Mission board</p>
        {missions.done.length > 0 && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5" /> {missions.done.length} done
          </p>
        )}
      </div>

      {missions.current ? (
        <CurrentMission missions={missions} first={first} link={link} pending={pending} run={run} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Pick a category. You&apos;ll get a mission from it with a goal, the steps and the words to use.</p>
          <div className="grid grid-cols-2 gap-2">
            {MISSION_CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={pending}
                onClick={() => run(() => startMission(c.key))}
                className="flex min-h-24 flex-col justify-between rounded-xl border-2 border-primary/30 bg-primary/5 p-3 text-left transition-colors hover:border-primary disabled:opacity-60"
              >
                <span className="text-sm font-bold leading-tight">{c.title}</span>
                <span className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.blurb}</span>
                {doneBy(c.key) > 0 && <span className="mt-1 text-[11px] font-semibold text-emerald-700">✓ {doneBy(c.key)} done</span>}
              </button>
            ))}
          </div>
          {pending && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Picking your mission…
            </p>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {missions.done.length > 0 && (
        <details className="rounded-xl border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">Finished missions</summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {missions.done.slice(0, 10).map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate">{d.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{elapsed(d.startedAt, new Date(d.finishedAt!))}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function CurrentMission({
  missions,
  first,
  link,
  pending,
  run,
}: {
  missions: MyMissions;
  first: string;
  link: string | null;
  pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; message?: string }>) => void;
}) {
  const m = missions.current!;
  const found = missionFor(m.missionKey);
  const category = categoryFor(m.category);
  const [now, setNow] = useState(() => new Date());
  const [copied, setCopied] = useState<number | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const percent = Math.round((m.progress / m.goal) * 100);
  const scripts = found ? found.mission.scripts({ first, link: link ?? "your link" }) : [];
  const best = missions.done
    .filter((d) => d.missionKey === m.missionKey && d.finishedAt)
    .map((d) => new Date(d.finishedAt!).getTime() - new Date(d.startedAt).getTime())
    .sort((a, b) => a - b)[0];

  async function copy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard refused: the words are on screen to copy by hand.
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border-2 border-primary p-3">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">{category?.title ?? "Mission"}</p>
        <p className="text-lg font-bold leading-tight">{m.title}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Timer className="h-3.5 w-3.5" /> Going for {elapsed(m.startedAt, now)}
          </span>
          {found && <span>· {found.mission.target}</span>}
          {best != null && <span>· Your best: {elapsed(new Date(0).toISOString(), new Date(best))}</span>}
        </p>
      </div>

      <div>
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-1 text-sm tabular-nums">
          <span className="font-bold">{m.progress}</span> of {m.goal} {found?.mission.unit ?? ""}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Button type="button" className="col-span-2 h-12 text-base" disabled={pending} onClick={() => run(() => countMission(m.id, 1))}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "+1"}
        </Button>
        <Button type="button" variant="outline" className="h-12" disabled={pending} onClick={() => run(() => countMission(m.id, m.goal >= 20 ? 5 : -1))}>
          {m.goal >= 20 ? "+5" : "−1"}
        </Button>
      </div>

      {found && (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {found.mission.steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      )}

      {scripts.map((s, i) => (
        <div key={s.label} className="rounded-lg bg-muted/50 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold">{s.label}</p>
            <button type="button" onClick={() => copy(i, s.text)} className="flex items-center gap-1 text-xs font-medium text-primary">
              {copied === i ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} {copied === i ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-sm">{s.text}</p>
        </div>
      ))}

      <button type="button" disabled={pending} onClick={() => run(() => dropMission(m.id))} className="self-start text-xs text-muted-foreground underline">
        Drop this mission and pick another
      </button>
    </div>
  );
}

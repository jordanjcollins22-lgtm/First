"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import { CATEGORY_LABEL, type Bottleneck, type Kpi, type KpiTone } from "@/lib/growth";
import { logOwnerTime, setOwnerHoursTarget } from "@/lib/actions/growth-actions";
import type { OwnerWeek } from "@/lib/data/growth";

const TONE: Record<KpiTone, string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  watch: "text-amber-700 dark:text-amber-300",
  bad: "text-destructive",
  unknown: "text-muted-foreground",
};

function weekLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The Sunday-night screen.
 *
 * Five numbers, one sentence, one button, and one small chart of the thing the
 * owner is actually trying to change. Everything else that could go here has a
 * home already -- the levers, the ramp plan, the forecast and the to-do list
 * are all on Business, and a second copy of them here would turn the one
 * screen with a single answer on it into a sixth analytics page.
 *
 * The chart is owner hours because that is the number nothing else in the app
 * tracks and the one the whole plan turns on: a business that grows while its
 * owner is needed less. Eight weeks and no more -- the question is "is this
 * going the right way", not "what happened in March".
 */
export function GrowthView({
  kpis,
  bottleneck,
  weeks,
  ownerHoursTarget,
  canSetTarget,
}: {
  kpis: Kpi[];
  bottleneck: Bottleneck;
  weeks: OwnerWeek[];
  ownerHoursTarget: number;
  canSetTarget: boolean;
}) {
  const router = useRouter();
  const [logging, setLogging] = useState(false);
  const [minutes, setMinutes] = useState("30");
  const [category, setCategory] = useState("rescheduling");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState(String(ownerHoursTarget));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const peak = Math.max(60, ...weeks.map((w) => w.loggedMinutes));

  function submit() {
    setError(null);
    start(async () => {
      const result = await logOwnerTime({ minutes: Number(minutes), category, note });
      if (!result.ok) setError(result.error);
      else {
        setLogging(false);
        setNote("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------- the one sentence */}
      <section className="rounded-xl border border-border bg-card/60 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          The one thing in the way
        </p>
        <p className="mt-1 text-lg font-semibold leading-snug">{bottleneck.says}</p>
        {bottleneck.fix && (
          <Link
            href={bottleneck.fix.href}
            className="mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            {bottleneck.fix.label} <ArrowRight className="h-4 w-4" />
          </Link>
        )}
      </section>

      {/* ------------------------------------------------------- the five */}
      <section className="grid gap-2 sm:grid-cols-2">
        {kpis.map((kpi) => (
          <div key={kpi.key} className="rounded-xl border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
            <p className={`text-2xl font-bold tabular-nums ${TONE[kpi.tone]}`}>{kpi.value}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{kpi.says}</p>
          </div>
        ))}
      </section>

      {/* ------------------------------------------- your hours, eight weeks */}
      <section className="space-y-2 rounded-xl border border-border p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Your hours in the work</h3>
          <span className="text-xs text-muted-foreground">Target {ownerHoursTarget} h a week</span>
        </div>

        <ul className="flex items-end gap-1">
          {weeks.map((week) => {
            const height = week.entries === 0 ? 0 : Math.max(4, Math.round((week.loggedMinutes / peak) * 64));
            return (
              <li key={week.weekStart} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-16 w-full items-end">
                  {/* Nothing logged draws a dashed outline, not a short bar. A
                      week of zero and a week nobody filled in have to look
                      different, or the chart lies by omission. */}
                  <div
                    className={
                      "w-full rounded-t " +
                      (week.entries === 0
                        ? "h-full border border-dashed border-border"
                        : week.loggedMinutes / 60 > ownerHoursTarget
                          ? "bg-amber-500/70"
                          : "bg-emerald-500/70")
                    }
                    style={week.entries === 0 ? undefined : { height: `${height}px` }}
                  />
                </div>
                <span className="text-[10px] leading-none text-muted-foreground">{weekLabel(week.weekStart)}</span>
                <span className="text-[10px] leading-none tabular-nums">
                  {week.entries === 0 ? "—" : (week.loggedMinutes / 60).toFixed(1)}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-muted-foreground">
          A dashed bar is a week nobody logged, not a week you did nothing.
          {weeks.some((w) => w.ownerTouches > 0) && (
            <> Decisions that came to you: {weeks.map((w) => w.ownerTouches).join(" · ")}.</>
          )}
        </p>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!logging ? (
          <button
            type="button"
            onClick={() => setLogging(true)}
            className="min-h-11 rounded-lg border border-border px-3 text-sm font-medium"
          >
            That took me time
          </button>
        ) : (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-medium">
                Minutes
                <input
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value)}
                  inputMode="numeric"
                  className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
                />
              </label>
              <label className="text-xs font-medium">
                On what
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
                >
                  {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — what it was"
              className="min-h-11 w-full rounded-md border border-border bg-background px-2 text-sm"
            />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={submit}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
              >
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Log it
              </button>
              <button
                type="button"
                onClick={() => setLogging(false)}
                className="min-h-11 px-3 text-sm text-muted-foreground"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {canSetTarget && (
          <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            Hours a week you want to be down to
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onBlur={() =>
                start(async () => {
                  const result = await setOwnerHoursTarget(Number(target));
                  if (!result.ok) setError(result.error);
                  else router.refresh();
                })
              }
              inputMode="decimal"
              className="min-h-9 w-16 rounded-md border border-border bg-background px-2 text-sm"
            />
          </label>
        )}
      </section>
    </div>
  );
}

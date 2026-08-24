"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Loader2, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { logTouch, updateChannel } from "@/lib/actions/outreach-actions";
import {
  COST_LABELS,
  OUTCOME_LABELS,
  TEMPERATURE_BLURBS,
  TEMPERATURE_LABELS,
  playbookSteps,
  type ChannelProgress,
  type ChannelResults,
  type Outcome,
  type Temperature,
} from "@/lib/outreach";

/** The outcomes worth a button on the channel card. The full set lives in the
 * module; these four are what somebody taps forty times in a morning. */
const QUICK: Outcome[] = ["attempted", "reached", "booked", "not_interested"];

const ORDER: Temperature[] = ["warm", "cold", "inbound"];

/**
 * The day's lead generation, channel by channel.
 *
 * This is the answer to a specific problem: the ways this business wins work
 * live in one person's head, so when they are away nobody books an evaluation.
 * A written playbook, a number to hit, and one tap to log turns that into
 * something a person who has never done it can pick up on a Monday.
 *
 * Warm first, deliberately. Ringing somebody we already did work for converts
 * several times better than any cold channel and costs nothing, and a page
 * that opens on cold calling teaches the wrong habit on the quiet days when
 * this screen actually gets opened.
 */
export function OutreachBoard({
  progress,
  results,
  windowDays,
  canEdit,
}: {
  progress: ChannelProgress[];
  results: ChannelResults[];
  windowDays: number;
  canEdit: boolean;
}) {
  const resultById = new Map(results.map((r) => [r.channelId, r]));

  const groups = ORDER.map((temperature) => ({
    temperature,
    items: progress.filter((p) => p.channel.temperature === temperature),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => (
        <section key={group.temperature}>
          <h3 className="text-sm font-bold">{TEMPERATURE_LABELS[group.temperature]}</h3>
          <p className="mb-2 text-xs text-muted-foreground">{TEMPERATURE_BLURBS[group.temperature]}</p>
          <div className="flex flex-col gap-2">
            {group.items.map((item) => (
              <ChannelCard
                key={item.channel.id}
                item={item}
                result={resultById.get(item.channel.id)}
                windowDays={windowDays}
                canEdit={canEdit}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ChannelCard({
  item,
  result,
  windowDays,
  canEdit,
}: {
  item: ChannelProgress;
  result: ChannelResults | undefined;
  windowDays: number;
  canEdit: boolean;
}) {
  const { channel } = item;
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const steps = playbookSteps(channel.playbook);

  function record(outcome: Outcome) {
    setError(null);
    startTransition(async () => {
      const res = await logTouch(channel.id, outcome);
      if (!res.ok) setError(res.message);
    });
  }

  return (
    <div
      className={`rounded-xl border backdrop-blur-md ${
        item.done ? "border-emerald-500/50 bg-emerald-50/60" : "border-white/60 bg-card/60"
      }`}
    >
      <div className="flex items-start justify-between gap-2 p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            {item.done && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
            <span className="truncate">{channel.name}</span>
          </p>
          {channel.summary && <p className="text-xs text-muted-foreground">{channel.summary}</p>}
        </div>
        <div className="shrink-0 text-right">
          {item.target != null ? (
            <p className="text-sm font-bold tabular-nums">
              {item.today}
              <span className="text-muted-foreground">/{item.target}</span>
            </p>
          ) : (
            <p className="text-sm font-bold tabular-nums">{item.today}</p>
          )}
          <p className="text-[10px] text-muted-foreground">{COST_LABELS[channel.costType]}</p>
        </div>
      </div>

      {item.fraction != null && (
        <div className="mx-3 mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${item.done ? "bg-emerald-500" : "bg-primary"}`}
            style={{ width: `${Math.round(item.fraction * 100)}%` }}
          />
        </div>
      )}

      {/* One tap per attempt. If logging a no-answer costs more than that it
          stops happening by Wednesday, and then nobody can tell whether a
          quiet week was a bad channel or a week nobody worked it. */}
      <div className="flex flex-wrap gap-1.5 px-3 pb-2">
        {QUICK.map((outcome) => (
          <Button
            key={outcome}
            type="button"
            size="sm"
            variant={outcome === "booked" ? "default" : "outline"}
            disabled={isPending}
            onClick={() => record(outcome)}
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {OUTCOME_LABELS[outcome]}
          </Button>
        ))}
      </div>

      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          How to do this ({steps.length} steps)
        </button>
        {result && result.attempts > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {result.booked} booked from {result.attempts} in {windowDays}d
          </span>
        )}
      </div>

      {open && (
        <div className="border-t border-border/60 px-3 py-3">
          {steps.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nobody has written this one down yet. That is exactly the gap this page exists to close.
            </p>
          ) : (
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm">
              {steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}

          {result && result.attempts > 0 && (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Last {windowDays} days: {result.attempts} attempts, {result.reached} reached,{" "}
              {result.booked} booked
              {result.closeRate != null && ` — ${result.closeRate}% of people spoken to`}
            </p>
          )}

          {canEdit && !editing && (
            <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit this playbook
            </Button>
          )}

          {canEdit && editing && (
            <ChannelEditor channel={channel} onDone={() => setEditing(false)} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Editing the playbook in place.
 *
 * The seeded steps are a starting point, not the company's opinion set in
 * stone — whoever actually makes the calls knows what works better than the
 * migration that wrote them, and a playbook nobody can correct is one people
 * quietly stop reading.
 */
function ChannelEditor({
  channel,
  onDone,
}: {
  channel: ChannelProgress["channel"];
  onDone: () => void;
}) {
  const [playbook, setPlaybook] = useState(channel.playbook ?? "");
  const [target, setTarget] = useState(channel.dailyTarget?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    const trimmed = target.trim();
    startTransition(async () => {
      const res = await updateChannel(channel.id, {
        playbook,
        dailyTarget: trimmed === "" ? null : Number(trimmed),
      });
      if (res.ok) onDone();
      else setError(res.message);
    });
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <label className="text-xs font-medium">
        Steps — one per line
        <Textarea
          value={playbook}
          onChange={(e) => setPlaybook(e.target.value)}
          rows={8}
          className="mt-1 text-sm"
        />
      </label>
      <label className="text-xs font-medium">
        How many a day — blank for no daily target
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="mt-1"
        />
      </label>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save} disabled={isPending}>
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { Check, Lock, Minus, Plus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { reopenStage, setStageCount, signOffStage } from "@/lib/actions/career-actions";
import {
  TIERS,
  stagesInTier,
  statusOf,
  summarize,
  targetMet,
  type Stage,
  type StageProgress,
} from "@/lib/career/stages";

const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * One person's whole ladder: what's signed off, the stage they're on, and
 * what's after it.
 *
 * Only the current stage can be signed off, and only the latest sign-off can
 * be taken back, so the ladder never has a gap in it.
 */
export function CareerLadder({
  profileId,
  progress,
  names,
  editable,
}: {
  profileId: string;
  progress: StageProgress[];
  /** Profile id to display name, for who signed each stage off. */
  names: Record<string, string>;
  editable: boolean;
}) {
  const summary = summarize(progress);
  const byStage = new Map(progress.map((p) => [p.stage, p]));

  return (
    <div className="space-y-6">
      {TIERS.map((tier) => {
        const stages = stagesInTier(tier.key);
        const done = stages.filter((s) => statusOf(s.number, summary) === "done").length;
        return (
          <section key={tier.key}>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">
                Tier {TIERS.indexOf(tier) + 1}: {tier.label}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  Stages {tier.first} to {tier.last}
                </span>
              </h2>
              <span className="shrink-0 text-sm text-muted-foreground">
                {done} of {stages.length}
              </span>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">{tier.blurb}</p>
            <ol className="space-y-2">
              {stages.map((stage) => (
                <StageRow
                  key={stage.number}
                  profileId={profileId}
                  stage={stage}
                  status={statusOf(stage.number, summary)}
                  row={byStage.get(stage.number)}
                  isLatestDone={stage.number === summary.completed}
                  names={names}
                  editable={editable}
                />
              ))}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function StageRow({
  profileId,
  stage,
  status,
  row,
  isLatestDone,
  names,
  editable,
}: {
  profileId: string;
  stage: Stage;
  status: "done" | "current" | "locked";
  row: StageProgress | undefined;
  isLatestDone: boolean;
  names: Record<string, string>;
  editable: boolean;
}) {
  const [count, setCount] = useState(row?.count ?? 0);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(action: () => Promise<{ error?: string }>, rollback?: () => void) {
    setError(null);
    start(async () => {
      const result = await action();
      if (result.error) {
        rollback?.();
        setError(result.error);
      }
    });
  }

  function bump(delta: number) {
    const previous = count;
    const next = Math.max(0, previous + delta);
    setCount(next);
    run(() => setStageCount(profileId, stage.number, next), () => setCount(previous));
  }

  const signer = row?.completed_by ? names[row.completed_by] : null;
  const canSignOff = targetMet(stage, count);

  return (
    <li
      className={cn(
        "rounded-lg border px-3 py-3",
        status === "done" && "border-primary/40 bg-primary/5",
        status === "current" && "border-primary bg-card shadow-sm ring-1 ring-primary/30",
        status === "locked" && "border-border bg-card/40 text-muted-foreground"
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
            status === "done" && "border-primary bg-primary text-primary-foreground",
            status === "current" && "border-primary text-primary",
            status === "locked" && "border-border"
          )}
          aria-hidden
        >
          {status === "done" ? <Check className="h-4 w-4" /> : status === "locked" ? <Lock className="h-3.5 w-3.5" /> : stage.number}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", status !== "locked" && "text-foreground")}>
            Stage {stage.number}: {stage.title}
            {status === "current" && (
              <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                Working on now
              </span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{stage.requirement}</p>

          {status === "done" && row?.completed_at && (
            <p className="mt-1 text-xs text-muted-foreground">
              Signed off {DATE.format(new Date(row.completed_at))}
              {signer ? ` by ${signer}` : ""}
              {row.note ? `: ${row.note}` : ""}
            </p>
          )}

          {stage.target && status !== "locked" && (
            <div className="mt-2 flex items-center gap-2">
              {editable && status === "current" && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={pending || count === 0}
                  onClick={() => bump(-1)}
                  aria-label="One fewer"
                >
                  <Minus className="h-4 w-4" />
                </Button>
              )}
              <span className="text-sm">
                <strong>{count}</strong> of {stage.target.count} {stage.target.unit}
              </span>
              {editable && status === "current" && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={pending}
                  onClick={() => bump(1)}
                  aria-label="One more"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}

          {editable && status === "current" && (
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Note for the sign-off (optional)"
                className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button
                type="button"
                size="sm"
                disabled={pending || !canSignOff}
                title={canSignOff ? undefined : `Needs ${stage.target?.count} ${stage.target?.unit} first`}
                onClick={() => run(() => signOffStage(profileId, stage.number, note))}
              >
                Sign off Stage {stage.number}
              </Button>
            </div>
          )}

          {editable && status === "done" && isLatestDone && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => reopenStage(profileId, stage.number))}
              className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              <RotateCcw className="h-3 w-3" /> Reopen this stage
            </button>
          )}

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        </div>
      </div>
    </li>
  );
}

"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type StageTone = "waiting" | "active" | "won" | "lost" | "muted";

const TONE_STYLE: Record<StageTone, string> = {
  waiting: "bg-sky-100 text-sky-800",
  active: "bg-amber-100 text-amber-800",
  won: "bg-emerald-100 text-emerald-800",
  lost: "bg-rose-100 text-rose-800",
  muted: "bg-muted text-muted-foreground",
};

/**
 * A breakdown laid out as a pipeline.
 *
 * One block per stage, in the order the stages happen, each headed with
 * its name and how many are in it. The reader sees the shape of somebody's
 * work at a glance, where a single list in date order would only say what
 * happened most recently.
 */
export function StageGroups({
  groups,
  emptyText,
}: {
  groups: { key: string; label: string; tone: StageTone; lines: ReactNode[] }[];
  emptyText: string;
}) {
  if (groups.length === 0) return <p className="text-xs text-muted-foreground">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((group) => (
        <div key={group.key}>
          <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className={cn("rounded px-1.5 py-0.5 normal-case tracking-normal", TONE_STYLE[group.tone])}>{group.label}</span>
            <span>{group.lines.length}</span>
          </p>
          <ul className="flex flex-col gap-1">{group.lines}</ul>
        </div>
      ))}
    </div>
  );
}

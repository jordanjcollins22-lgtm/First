"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { AffiliateLeaderboard } from "@/components/marketing/outreach-board";
import { EvaluationLeaderboard } from "@/components/evaluations/evaluation-leaderboard";
import { CrewLeaderboard } from "@/components/crew/crew-leaderboard";
import type { PersonStanding } from "@/lib/outreach-links";
import type { EvaluationBoards } from "@/lib/data/evaluation-leaderboard";
import type { CrewBoards } from "@/lib/data/crew-leaderboard";

/**
 * The three leaderboards on one screen.
 *
 * Affiliates: who answers neighbours and who books from it. Evaluators:
 * who turns visits into jobs. Crew: who gets the work done and done right.
 * Everybody sees all three; the money columns are the owner's.
 */
export function LeaderboardsView({
  affiliates,
  evaluations,
  crew,
  showMoney,
  meId,
}: {
  affiliates: PersonStanding[];
  evaluations: EvaluationBoards;
  crew: CrewBoards;
  showMoney: boolean;
  meId: string | null;
}) {
  const [tab, setTab] = useState<"affiliates" | "evaluators" | "crew">("affiliates");
  const tabs = [
    { key: "affiliates" as const, label: "Affiliates" },
    { key: "evaluators" as const, label: "Evaluators" },
    { key: "crew" as const, label: "Crew" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-xs",
              tab === t.key ? "border-primary bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "affiliates" && (
        <AffiliateLeaderboard standings={affiliates} showMoney={showMoney} canOpen={() => false} selected={null} onSelect={() => {}} />
      )}
      {tab === "evaluators" && <EvaluationLeaderboard boards={evaluations} showMoney={showMoney} meId={meId} />}
      {tab === "crew" && <CrewLeaderboard boards={crew} meId={meId} />}
    </div>
  );
}

"use client";

import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { getCategory } from "@/lib/accounting/schedule-c";
import { deleteRule } from "@/lib/actions/accounting-actions";

export function RuleList({ rules }: { rules: { id: string; match_text: string; category: string }[] }) {
  const [isPending, startTransition] = useTransition();
  return (
    <ul className="divide-y divide-border rounded-md border border-border bg-card text-sm">
      {rules.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <span>
            Contains <code>&quot;{r.match_text}&quot;</code> → {getCategory(r.category).label}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={isPending}
            onClick={() => startTransition(async () => void (await deleteRule(r.id)))}
          >
            Remove
          </Button>
        </li>
      ))}
    </ul>
  );
}

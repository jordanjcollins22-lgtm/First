"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { runStageNow } from "@/lib/actions/govcon-actions";

export function RunButtons() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const run = (stage: "discover" | "process") =>
    start(async () => {
      setResult(null);
      try {
        const r = await runStageNow(stage);
        setResult(r.ok ? `${stage} finished` : `${stage} failed: ${r.error}`);
      } catch (e) {
        setResult((e as Error).message);
      }
    });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run("discover")}>
        Find new bids now
      </Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run("process")}>
        Process pipeline now
      </Button>
      {pending && <span className="text-xs text-muted-foreground">Running (can take a few minutes)…</span>}
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
    </div>
  );
}

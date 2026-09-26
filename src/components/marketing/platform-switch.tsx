"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { pauseGroupAgent, resumeGroupAgent, setRedditEnabled } from "@/lib/actions/outreach-agent-actions";

/** Reddit on or off, one press. */
export function RedditSwitch({ enabled, owner }: { enabled: boolean; owner: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function flip() {
    setError(null);
    startTransition(async () => {
      const result = await setRedditEnabled(!on);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOn(!on);
      router.refresh();
    });
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className={`text-xs font-medium ${on ? "text-emerald-700" : "text-muted-foreground"}`}>{on ? "On" : "Off"}</span>
      {owner && (
        <Button type="button" size="sm" variant={on ? "outline" : "default"} disabled={pending} onClick={flip}>
          {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
          {on ? "Turn off" : "Turn on"}
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

/** The finder as a whole: resume it, or pause it for a day or until told. */
export function FinderPower({ paused, owner }: { paused: boolean; owner: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  if (!owner) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {pending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      {paused ? (
        <Button type="button" size="sm" disabled={pending} onClick={() => run(() => resumeGroupAgent())}>
          Resume
        </Button>
      ) : (
        <>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => pauseGroupAgent({ hours: 24, reason: "Paused by hand." }))}>
            Pause a day
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => pauseGroupAgent({ hours: null, reason: "Paused by hand." }))}>
            Pause
          </Button>
        </>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

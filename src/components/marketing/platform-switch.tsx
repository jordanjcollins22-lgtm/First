"use client";

import { useEffect, useState, useTransition } from "react";
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

const FROM_APP = "js-finder-app";
const FROM_EXTENSION = "js-finder-extension";

/**
 * Whether the post finder extension is installed in this Chrome, and which
 * version. It says so on the app's pages; null until it has, or when it isn't.
 */
function useExtensionHere(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    function heard(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      const data = event.data as { source?: string; type?: string; version?: string } | null;
      if (data?.source === FROM_EXTENSION && data.type === "here") setVersion(data.version ?? "?");
    }
    window.addEventListener("message", heard);
    window.postMessage({ source: FROM_APP, type: "hello" }, window.location.origin);
    return () => window.removeEventListener("message", heard);
  }, []);
  return version;
}

/**
 * The finder's one switch: Start finding posts, Stop finding posts. It is the
 * only one; the extension has none of its own. Pressed here, the extension
 * in this Chrome is told at once, so its window opens or closes straight
 * away rather than at its next check.
 */
export function FinderPower({ paused, owner }: { paused: boolean; owner: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const extension = useExtensionHere();

  function flip() {
    setError(null);
    startTransition(async () => {
      const result = paused ? await resumeGroupAgent() : await pauseGroupAgent({ hours: null, reason: "Stopped from the app." });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Now, not in a minute.
      window.postMessage({ source: FROM_APP, type: "power" }, window.location.origin);
      router.refresh();
    });
  }

  if (!owner) return null;
  return (
    <span className="flex flex-col items-end gap-1">
      <Button type="button" variant={paused ? "default" : "outline"} disabled={pending} onClick={flip}>
        {pending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        {paused ? "Start finding posts" : "Stop finding posts"}
      </Button>
      <span className="text-[11px] text-muted-foreground">
        {extension
          ? `Extension v${extension} is on in this Chrome.`
          : "The extension isn't in this Chrome. It runs wherever it's installed."}
      </span>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}

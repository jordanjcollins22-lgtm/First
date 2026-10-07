"use client";

import { useState, useTransition } from "react";
import { BellOff, BellRing, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { setQuickMowAlerts } from "@/lib/actions/mow-order-actions";

/** The two-minute team alerts, on or off. Only an owner or admin can flip it. */
export function AlertsSwitch({ on, canSwitch }: { on: boolean; canSwitch: boolean }) {
  const [value, setValue] = useState(on);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`flex items-center gap-1 text-sm font-semibold ${value ? "text-emerald-700" : "text-amber-800"}`}>
        {value ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} Team alerts {value ? "on" : "off"}
      </span>
      {canSwitch && (
        <Button
          type="button"
          size="sm"
          variant={value ? "outline" : "default"}
          disabled={busy}
          onClick={() =>
            start(async () => {
              const result = await setQuickMowAlerts(!value);
              if (!result.ok) return setError(result.message);
              setValue(!value);
            })
          }
        >
          {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {value ? "Turn off" : "Turn on"}
        </Button>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

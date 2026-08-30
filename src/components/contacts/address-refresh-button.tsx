"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { refreshStaleAddresses } from "@/lib/actions/geocode-actions";

/**
 * For an address that was corrected and never moved.
 *
 * An imported contact keeps its address twice: what the file said, and the
 * property the geocoder made from it. The property is what every map and this
 * very list read. Re-importing a corrected file used to update only the first,
 * so a fixed address kept appearing here as if nothing had been done about it.
 *
 * Imports queue their own corrections now. This is for the ones already in
 * that state — it finds every contact whose property disagrees with the file
 * and hands them back to the placing step.
 */
export function AddressRefreshButton() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    setStatus(null);
    start(async () => {
      const result = await refreshStaleAddresses();
      if (result.ok) setStatus(result.message);
      else setError(result.message);
    });
  }

  return (
    <div className="mb-3 flex flex-col gap-1.5">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={run}>
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "Checking…" : "I already fixed these — re-check"}
      </Button>
      {status && <p className="text-xs text-amber-900">{status}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

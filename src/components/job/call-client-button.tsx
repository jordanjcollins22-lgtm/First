"use client";

import { useState, useTransition } from "react";
import { Phone } from "lucide-react";

import { Button } from "@/components/ui/button";
import { startCall } from "@/lib/actions/call-actions";

export function CallClientButton({ jobId }: { jobId: string }) {
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(null);

  function handleCall() {
    setStatus(null);
    startTransition(async () => {
      try {
        await startCall(jobId);
        setStatus("Calling your phone now — answer to connect.");
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "Couldn't start the call.");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleCall}>
        <Phone className="h-3.5 w-3.5" />
        {isPending ? "Calling..." : "Call client"}
      </Button>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}

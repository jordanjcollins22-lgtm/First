"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptServiceType, denyServiceType } from "@/lib/actions/service-pricing-actions";
import { priceFromCogs } from "@/lib/pricing";

export function PendingServiceRow({
  serviceTypeId,
  name,
  requestedByEmail,
  requestedNote,
}: {
  serviceTypeId: string;
  name: string;
  requestedByEmail: string | null;
  requestedNote: string | null;
}) {
  const [showAccept, setShowAccept] = useState(false);
  const [cogs, setCogs] = useState("");
  const [cost, setCost] = useState("");
  const [costUnit, setCostUnit] = useState("flat rate");
  const [hours, setHours] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleCogsChange(value: string) {
    setCogs(value);
    setCost(value.trim() ? priceFromCogs(Number(value)).toString() : "");
  }

  function handleAccept() {
    setError(null);
    startTransition(async () => {
      try {
        await acceptServiceType(
          serviceTypeId,
          cogs.trim() ? Number(cogs) : null,
          cost.trim() ? Number(cost) : null,
          costUnit,
          hours.trim() ? Number(hours) : null
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleDeny() {
    setError(null);
    startTransition(() => denyServiceType(serviceTypeId));
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{name}</p>
          <p className="text-xs text-muted-foreground">
            Proposed by {requestedByEmail ?? "a team member"}
            {requestedNote && ` — ${requestedNote}`}
          </p>
        </div>
        {!showAccept && (
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={isPending} onClick={() => setShowAccept(true)}>
              Accept
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={handleDeny}>
              Deny
            </Button>
          </div>
        )}
      </div>
      {showAccept && (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-muted/30 p-2.5">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">COGS</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              placeholder="0.00"
              value={cogs}
              onChange={(e) => handleCogsChange(e.target.value)}
              className="h-9 w-24 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Price {cogs.trim() && "(auto)"}</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              placeholder="0.00"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              className="h-9 w-24 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Unit</Label>
            <Input
              value={costUnit}
              onChange={(e) => setCostUnit(e.target.value)}
              className="h-9 w-28 text-sm"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Est. hours</Label>
            <Input
              type="number"
              step="0.25"
              min={0}
              placeholder="0"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="h-9 w-24 text-sm"
            />
          </div>
          <Button type="button" size="sm" disabled={isPending} onClick={handleAccept}>
            {isPending ? "Saving..." : "Confirm accept"}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={isPending} onClick={() => setShowAccept(false)}>
            Cancel
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

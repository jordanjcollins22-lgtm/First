"use client";

import { useMemo, useState, useTransition } from "react";
import { Minus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trimSentProposal } from "@/lib/actions/proposal-trim-actions";
import { centsToInput, scopeLines, trimProposal } from "@/lib/proposal-trim";
import type { ProposalZoneSnapshot } from "@/types/domain";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Taking things off a proposal that is already out.
 *
 * Tap what goes, watch the price move, save. The removed things stay on
 * screen greyed out with a way back, because the most common mistake here is
 * removing one line too many and the second most common is not being sure
 * whether you did.
 *
 * The total is worked out live but stays editable: a hand-priced area or a
 * discount means the subtraction is a suggestion rather than an answer, and
 * the panel says which it is rather than presenting both the same way.
 */
export function TrimPanel({
  proposalId,
  zones,
  totalCents,
  onDone,
}: {
  proposalId: string;
  zones: ProposalZoneSnapshot[];
  totalCents: number;
  onDone: () => void;
}) {
  const [removedZones, setRemovedZones] = useState<string[]>([]);
  const [removedLines, setRemovedLines] = useState<{ zoneName: string; line: string }[]>([]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Null while the office has not overruled the arithmetic.
  const [priceOverride, setPriceOverride] = useState<string | null>(null);

  const result = useMemo(
    () =>
      trimProposal({
        zones,
        removeZones: removedZones,
        removeLines: removedLines,
        statedTotalCents: totalCents,
      }),
    [zones, removedZones, removedLines, totalCents]
  );

  const priceValue = priceOverride ?? centsToInput(result.newTotalCents);
  const savingCents = Math.round((Number(priceValue) || 0) * 100);

  function toggleZone(zoneName: string) {
    setRemovedZones((current) =>
      current.includes(zoneName) ? current.filter((z) => z !== zoneName) : [...current, zoneName]
    );
    setPriceOverride(null);
  }

  function toggleLine(zoneName: string, line: string) {
    setRemovedLines((current) => {
      const has = current.some((l) => l.zoneName === zoneName && l.line === line);
      return has
        ? current.filter((l) => !(l.zoneName === zoneName && l.line === line))
        : [...current, { zoneName, line }];
    });
  }

  function isLineRemoved(zoneName: string, line: string): boolean {
    return removedLines.some((l) => l.zoneName === zoneName && l.line === line);
  }

  function save() {
    setError(null);
    start(async () => {
      const response = await trimSentProposal({
        proposalId,
        removeZones: removedZones,
        removeLines: removedLines,
        totalCents: savingCents,
      });
      if (response.ok) onDone();
      else setError(response.message);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Remove from this quote</p>
        <p className="text-xs text-muted-foreground">Was {money(totalCents)}</p>
      </div>

      <div className="flex flex-col gap-2">
        {zones.map((zone) => {
          const gone = removedZones.includes(zone.zoneName);
          const lines = scopeLines(zone.scopeText);
          return (
            <div
              key={zone.zoneName}
              className={`rounded-lg border border-white/60 bg-card/70 p-2.5 ${gone ? "opacity-50" : ""}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`text-sm font-semibold ${gone ? "line-through" : ""}`}>
                    {zone.zoneName}
                  </p>
                  <p className="text-xs text-primary">{zone.serviceLabel}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {zone.priceCents == null ? "no price" : money(zone.priceCents)}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={gone ? "ghost" : "outline"}
                    className="h-8 px-2"
                    onClick={() => toggleZone(zone.zoneName)}
                  >
                    {gone ? <RotateCcw className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {/* The written lines, removable one at a time. Wording rather
                  than money, so none of these move the price. */}
              {!gone && lines.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1">
                  {lines.map((line) => {
                    const lineGone = isLineRemoved(zone.zoneName, line);
                    return (
                      <li key={line} className="flex items-start justify-between gap-2">
                        <span
                          className={`text-xs ${
                            lineGone ? "text-muted-foreground line-through" : "text-muted-foreground"
                          }`}
                        >
                          {line}
                        </span>
                        <button
                          type="button"
                          onClick={() => toggleLine(zone.zoneName, line)}
                          className="shrink-0 text-xs font-semibold text-primary"
                        >
                          {lineGone ? "Undo" : "Remove"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">New total $</span>
        <Input
          type="number"
          value={priceValue}
          onChange={(e) => setPriceOverride(e.target.value)}
          className="h-9 w-28 text-sm"
          disabled={pending}
        />
        {result.removedCents > 0 && (
          <span className="text-xs text-muted-foreground">
            {money(result.removedCents)} came off
          </span>
        )}
      </div>

      {result.totalNote && <p className="text-xs text-amber-600">{result.totalNote}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending || result.empty} onClick={save}>
          {pending ? "Updating…" : "Update proposal"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={onDone}>
          Cancel
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        The client&apos;s link stays the same. They see this the next time they open it.
      </p>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

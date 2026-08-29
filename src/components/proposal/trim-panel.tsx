"use client";

import { useMemo, useState, useTransition } from "react";
import { Minus, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AutoTextarea } from "@/components/ui/auto-textarea";
import { ChipRow } from "@/components/ui/chip-row";
import { trimSentProposal } from "@/lib/actions/proposal-trim-actions";
import {
  REQUEST_SOURCES,
  centsToInput,
  hasChange,
  saveLabel,
  scopeLines,
  trimProposal,
  type RequestSource,
} from "@/lib/proposal-trim";
import type { ProposalZoneSnapshot } from "@/types/domain";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Changing a proposal that is already out, on the client's behalf.
 *
 * Tap what goes, watch the price move, save. The removed things stay on
 * screen greyed out with a way back, because the most common mistake here is
 * removing one line too many and the second most common is not being sure
 * whether you did.
 *
 * Removing is not the only change. Most of these arrive as a text message —
 * the client reads the proposal on their phone, does not touch the buttons on
 * it, and texts instead — so the price can be changed on its own, a note of
 * what they actually said goes with it, and the record says how they asked.
 * Without that, months later, it reads like we quietly changed a quote
 * nobody asked us to change.
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
  const [note, setNote] = useState("");
  const [source, setSource] = useState<RequestSource>("text");
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
  const changed = hasChange({
    removedZones: result.removedZones,
    removedLines: result.removedLines,
    statedTotalCents: totalCents,
    newTotalCents: savingCents,
    note,
  });

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
        note,
        requestedVia: source,
      });
      if (response.ok) onDone();
      else setError(response.message);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Change this quote</p>
        <p className="text-xs text-muted-foreground">Was {money(totalCents)}</p>
      </div>

      {/* How they asked. Most of these are a text message, which is why it
          is the one already picked. */}
      <ChipRow options={REQUEST_SOURCES} value={source} onChange={setSource} />

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

      {/* What they actually said, in their words where possible. This is the
          part somebody will want in six months, not the arithmetic. */}
      <AutoTextarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={1}
        placeholder="What did they say? (optional)"
        className="min-h-10 py-2 text-sm"
      />

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={pending || !changed} onClick={save}>
          {pending
            ? "Saving…"
            : saveLabel({
                removedZones: result.removedZones,
                removedLines: result.removedLines,
                statedTotalCents: totalCents,
                newTotalCents: savingCents,
              })}
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

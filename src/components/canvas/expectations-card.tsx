"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Leaf } from "lucide-react";

import type { WorkZone } from "@/components/canvas/types";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import { expectationsFor } from "@/lib/expectations";

/**
 * What to say about this property before leaving it.
 *
 * The briefing page teaches the conversation; this is the prompt on the day,
 * built from the zones actually drawn. Generic training is read once and
 * forgotten. A list saying "you have drawn seeding and new planting on this
 * property, here are the two things to say about them" is read now, because
 * it is about the lawn the evaluator is standing on.
 *
 * Collapsed by default and never in the way. An evaluator who already knows
 * this should not have to scroll past it on every job, and one who does not
 * should find it a tap from the submit button rather than in a policy
 * document nobody opens twice.
 */
export function ExpectationsCard({ zones }: { zones: WorkZone[] }) {
  const [open, setOpen] = useState(false);

  const areas = zones
    .filter((zone) => zone.service)
    .map((zone) => {
      const type = serviceTypeById(zone.service!.typeId);
      return {
        serviceLabel: type?.label ?? zone.service!.typeId,
        scopeText: type?.autoScope?.(zone.service!.values) ?? "",
      };
    });

  const points = expectationsFor(areas);
  if (points.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <Leaf className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-medium">Say this before you leave</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {points.length} thing{points.length === 1 ? "" : "s"}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 py-2">
          <p className="text-xs text-muted-foreground">
            Based on what you have drawn. The client gets all of this in writing on the proposal
            too, so what you say now and what they read tonight are the same promise.
          </p>
          <ul className="mt-2 flex flex-col gap-2">
            {points.map((point) => (
              <li key={point.heading}>
                <p className="text-sm font-medium">{point.heading}</p>
                <p className="text-xs text-muted-foreground">{point.timeframe}</p>
                {point.theirPart && (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium">Their part: </span>
                    {point.theirPart}
                  </p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Then ask them to say it back.{" "}
            <Link href="/admin/expectations" className="underline" target="_blank">
              The full briefing
            </Link>{" "}
            has the words for it.
          </p>
        </div>
      )}
    </div>
  );
}

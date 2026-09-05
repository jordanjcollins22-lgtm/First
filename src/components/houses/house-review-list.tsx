"use client";

import { useState, useTransition } from "react";
import { Check, MapPinOff, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STAGE_COLOR, STAGE_LABEL } from "@/lib/house-relationship";
import { acceptHouse, correctHouseAddress, holdHouse } from "@/lib/actions/house-review-actions";
import type { HouseForReview } from "@/lib/data/houses";

/**
 * The addresses nobody has settled yet.
 *
 * Each one says what is wrong with it in the same words the check used, so the
 * decision is made against the reason rather than against a flag. "Pinned about
 * 1,440 miles from the service area" is answerable; "needs review" is not.
 *
 * Ones with history come first. A held address carrying an evaluation is
 * somebody's actual customer, and getting that wrong costs more than getting a
 * stranger's parcel wrong.
 */
export function HouseReviewList({ houses }: { houses: HouseForReview[] }) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function run(work: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await work();
        setEditing(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That didn't save.");
      }
    });
  }

  if (houses.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        Nothing is waiting. Every address is either on the map or settled.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {houses.map((house) => (
        <div key={house.id} className="flex flex-col gap-2 rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              {/* The raw address, never the normalized key. The key is for
                  matching; this is for recognising. */}
              <p className="font-medium">{house.address}</p>
              {house.reviewReason && (
                <p className="mt-0.5 text-sm text-amber-700">{house.reviewReason}</p>
              )}
            </div>

            {/* History is the reason to be careful with this one. */}
            {house.eventCount > 0 && (
              <span
                className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                style={{ backgroundColor: STAGE_COLOR[house.stage] }}
              >
                {STAGE_LABEL[house.stage]}
                {house.eventCount > 1 && ` · ${house.eventCount} events`}
              </span>
            )}
          </div>

          {house.contacts.length > 0 && (
            <p className="text-xs text-muted-foreground">{house.contacts.join(", ")}</p>
          )}

          {editing === house.id ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="The correct address"
                className="text-sm"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={() => run(() => correctHouseAddress(house.id, draft))}
                >
                  Save
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={isPending}
                onClick={() => run(() => acceptHouse(house.id))}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                It&apos;s a house
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => {
                  setDraft(house.address);
                  setEditing(house.id);
                }}
              >
                <Pencil className="mr-1 h-3.5 w-3.5" />
                Fix the address
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={isPending}
                onClick={() => run(() => holdHouse(house.id, house.reviewReason ?? "Not a single house"))}
              >
                <MapPinOff className="mr-1 h-3.5 w-3.5" />
                Keep it off the map
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

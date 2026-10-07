"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Check, Landmark, MapPinOff, Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { STAGE_COLOR, STAGE_LABEL } from "@/lib/house-relationship";
import {
  acceptHouse,
  correctHouseAddress,
  holdHouse,
  searchAddresses,
  type ActionResult,
  type AddressHit,
} from "@/lib/actions/house-review-actions";
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
  const [note, setNote] = useState<string | null>(null);

  // Actions return their outcome. A thrown one would reach this page, in
  // production, as React error #441 with the message stripped out.
  function run(work: () => Promise<ActionResult<unknown>>) {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const value = result.value as { message?: string } | null;
      if (value?.message) setNote(value.message);
      setEditing(null);
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
      {note && <p className="text-sm text-emerald-700">{note}</p>}

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
            <AddressEditor
              initial={draft}
              houseId={house.id}
              busy={isPending}
              onSave={(address) => run(() => correctHouseAddress(house.id, address))}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              {house.countySuggestion && (
                <Button
                  type="button"
                  size="sm"
                  disabled={isPending}
                  onClick={() => run(() => correctHouseAddress(house.id, house.countySuggestion!))}
                  title="Take the county's address and pin for this house"
                >
                  <Landmark className="mr-1 h-3.5 w-3.5" />
                  Use the county&apos;s: {house.countySuggestion}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant={house.countySuggestion ? "outline" : "default"}
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

/**
 * The correct address, found rather than typed.
 *
 * Searches the county's addresses as the person types and offers the
 * matches; picking one fills the box with the county's exact spelling, which
 * is what lets the save absorb the county's row, pin included. Typing
 * something the county does not have still saves -- a house outside Harford
 * is a real house -- it just stays held if its pin is still wrong.
 */
function AddressEditor({
  initial,
  houseId,
  busy,
  onSave,
  onCancel,
}: {
  initial: string;
  houseId: string;
  busy: boolean;
  onSave: (address: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [hits, setHits] = useState<AddressHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<AddressHit | null>(null);
  /** A finished search that found nothing: the county has no such address. */
  const [noneFound, setNoneFound] = useState(false);
  const latest = useRef(0);

  useEffect(() => {
    if (picked || value.trim().length < 3) return;
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      const result = await searchAddresses(value, houseId);
      // A slower earlier search must not overwrite a newer one's answer.
      if (ticket !== latest.current) return;
      const found = result.ok ? result.value : [];
      setHits(found);
      setNoneFound(result.ok && found.length === 0);
      setSearching(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [value, picked, houseId]);

  function choose(hit: AddressHit) {
    setValue(hit.address);
    setPicked(hit);
    setHits([]);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Input
          value={value}
          autoFocus
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            setPicked(null);
            setNoneFound(false);
            if (next.trim().length < 3) setHits([]);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (hits.length > 0 && !picked) choose(hits[0]);
              else onSave(value);
            }
            if (e.key === "Escape") onCancel();
          }}
          placeholder="Start typing the address: 102 barton"
          className="text-sm"
        />
        {(hits.length > 0 || searching) && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-background shadow-md">
            {searching && hits.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">Searching the county…</li>
            )}
            {hits.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(hit)}
                >
                  <span>{hit.address}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{hit.ours ? "already ours" : "county"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {picked?.ours
          ? "Already one of our houses. Saving merges this held record into it: its people and history move across, and the duplicate goes."
          : picked
            ? "The county's address. Saving links this house to the county's record and pin."
            : noneFound && value.trim().length >= 3
              ? "No county address matches. Saving keeps what you typed and looks up its location; military housing and a few new streets are not in the county's data."
              : "Pick an address from the list, or save what you typed."}
      </p>
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={busy || !value.trim()} onClick={() => onSave(value)}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

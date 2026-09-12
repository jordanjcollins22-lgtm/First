"use client";

import { useState, useTransition } from "react";
import { Lock, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AD_HEIGHT_IN, AD_WIDTH_IN } from "@/lib/flyer";
import { sheetSummary, squaresForSide, type SheetSquare } from "@/lib/flyer-sheet";
import { addBookingToRun, setBookingSlot } from "@/lib/actions/flyer-run-actions";

/**
 * Both sides of one run, as they would print.
 *
 * The office was told how many spots were sold and never shown the sheet, so
 * the only way to know what a run actually looked like was to wait for it to
 * come back from the printer. Tapping an empty square puts somebody in it,
 * which is the other half: not every spot is sold through the public form.
 * Somebody pays cash, somebody swaps a spot for work, somebody has always
 * been on the flyer.
 */
export function RunSheet({ runId, squares }: { runId: string; squares: SheetSquare[] }) {
  const [picking, setPicking] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{sheetSummary(squares)}</p>

      <div className="grid grid-cols-2 gap-3">
        {(["front", "back"] as const).map((side) => (
          <div key={side}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {side === "front" ? "Front" : "Back"}
            </p>
            <div className="rounded-lg border border-border bg-white p-[3%]">
              <div className="grid grid-cols-2 gap-[3%]">
                {squaresForSide(squares, side).map((square) => (
                  <Square
                    key={square.slot}
                    square={square}
                    onPick={() => setPicking(square.slot)}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {picking != null && (
        <FillSquare runId={runId} slot={picking} onDone={() => setPicking(null)} />
      )}
    </div>
  );
}

function Square({ square, onPick }: { square: SheetSquare; onPick: () => void }) {
  const [pending, start] = useTransition();

  return (
    <div
      className="relative overflow-hidden rounded-sm border border-border/60 bg-white"
      style={{ aspectRatio: `${AD_WIDTH_IN} / ${AD_HEIGHT_IN}` }}
    >
      {square.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={square.imageUrl} alt={square.businessName ?? ""} className="h-full w-full object-cover" />
      ) : square.source === "open" ? (
        <button
          type="button"
          onClick={onPick}
          className="flex h-full w-full flex-col items-center justify-center gap-0.5 p-1 text-center"
        >
          <Plus className="h-3.5 w-3.5 text-primary" />
          <span className="text-[7px] leading-tight text-muted-foreground">Add</span>
        </button>
      ) : (
        // Taken, but no artwork yet. Offering "Add" here would invite
        // somebody to sell a square that is already somebody's.
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 p-1 text-center">
          {square.isHouse ? (
            <>
              <Lock className="h-3 w-3 text-muted-foreground" />
              <span className="text-[7px] leading-tight text-muted-foreground">Ours</span>
            </>
          ) : (
            <span className="text-[7px] leading-tight text-muted-foreground">Artwork to come</span>
          )}
        </span>
      )}

      {/* Who is in it, and a way out. Legible over artwork, because the
          alternative is opening every square to find out. */}
      {square.businessName && (
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-black/60 px-1 py-0.5">
          <span className="min-w-0 flex-1 truncate text-[7px] text-white">
            {square.businessName}
          </span>
          {square.bookingId && (
            <button
              type="button"
              aria-label={`Take ${square.businessName} out of this square`}
              disabled={pending}
              onClick={() =>
                start(async () => void (await setBookingSlot({ bookingId: square.bookingId!, slot: null })))
              }
            >
              <X className="h-2.5 w-2.5 text-white" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

function FillSquare({
  runId,
  slot,
  onDone,
}: {
  runId: string;
  slot: number;
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="text-xs font-semibold">Who goes in square {slot}?</p>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Business name" />
      <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" type="tel" />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" className="flex-1" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          className="flex-1"
          disabled={pending || !name.trim()}
          onClick={() => {
            setError(null);
            start(async () => {
              const result = await addBookingToRun({
                runId,
                businessName: name,
                phone,
                slot,
              });
              if (result.ok) onDone();
              else setError(result.message);
            });
          }}
        >
          {pending ? "Adding…" : "Add them"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Added by hand counts as settled. Their artwork goes on from the flyer builder above.
      </p>
    </div>
  );
}

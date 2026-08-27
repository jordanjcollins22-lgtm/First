"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { Copy, ImageUp, Loader2, Printer, Scissors, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { clearDoorHanger, saveDoorHanger } from "@/lib/actions/door-hanger-actions";
import {
  ARTWORK_PIXEL_HEIGHT,
  ARTWORK_PIXEL_WIDTH,
  HANGER_HEIGHT_IN,
  HANGER_WIDTH_IN,
  SIDES,
  dieLine,
  hangersPerSheet,
  isFilled,
  safeTopIn,
  sheetsNeeded,
  type HangerSide,
  type HangerSlot,
} from "@/lib/door-hanger";

const BUCKET = "print-artwork";

function publicUrlFor(path: string): string {
  return createClient().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * The door hanger sheet, as it prints.
 *
 * One letter sheet, cut down the middle, two hangers. The knob hole and the
 * slot are drawn on every half whether or not there is artwork on it — a
 * hanger without them cannot go on a door, and that is exactly the thing
 * nobody notices until the run is finished.
 */
export function DoorHangerSheet({ slots }: { slots: HangerSlot[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<HangerSide | null>(null);
  const [runSize, setRunSize] = useState("500");

  const bySide = new Map(slots.map((slot) => [slot.side, slot]));
  const perSheet = hangersPerSheet(slots);
  const sheets = sheetsNeeded(Number(runSize) || 0, slots);

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 sm:py-6">
      <div className="print-hide">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Door hangers</h1>
            <p className="text-sm text-muted-foreground">
              Two to a letter sheet, cut down the middle. The knob hole and slot are drawn for you.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="Per sheet" value={perSheet === 0 ? "—" : String(perSheet)} />
          <Stat
            label={`Sheets for ${runSize || "0"}`}
            value={sheets != null ? String(sheets) : "—"}
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">How many hangers?</span>
          <Input
            value={runSize}
            onChange={(event) => setRunSize(event.target.value)}
            inputMode="numeric"
            className="h-9 w-28"
          />
        </div>

        {perSheet === 1 && (
          <p className="mt-2 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-800">
            Only one half has artwork, so every sheet yields one hanger and one piece of scrap. Put
            something on the other half — the same design is fine — to get two.
          </p>
        )}

        <p className="mt-2 rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-sm text-muted-foreground backdrop-blur-md">
          Artwork is {HANGER_WIDTH_IN}&Prime; &times; {HANGER_HEIGHT_IN}&Prime; —{" "}
          <span className="font-medium text-foreground">
            {ARTWORK_PIXEL_WIDTH} &times; {ARTWORK_PIXEL_HEIGHT}px
          </span>
          . Keep anything that matters below the top {safeTopIn()}&Prime;: that part is cut away or
          has a hole through it.
        </p>

        <p className="mt-2 rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground backdrop-blur-md">
          Printing: set <span className="font-medium text-foreground">Margins</span> to None and{" "}
          <span className="font-medium text-foreground">Scale</span> to 100%, or the hole ends up in
          the wrong place.
        </p>
      </div>

      <div className="print-root mt-5">
        <div
          className="print-sheet relative mx-auto flex w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm"
          style={{ aspectRatio: "8.5 / 11" }}
        >
          {SIDES.map((side) => (
            <HangerHalf
              key={side}
              side={side}
              slot={bySide.get(side)}
              onPick={() => setEditing(side)}
            />
          ))}

          {/* Where the guillotine goes. */}
          <div
            className="pointer-events-none absolute inset-y-0 left-1/2 w-0 border-l-2 border-dashed border-neutral-400"
            aria-hidden
          />
        </div>
      </div>

      {editing && (
        <EditHalf
          side={editing}
          slot={bySide.get(editing)}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/60 bg-card/60 px-3 py-2 backdrop-blur-md">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}

function HangerHalf({
  side,
  slot,
  onPick,
}: {
  side: HangerSide;
  slot: HangerSlot | undefined;
  onPick: () => void;
}) {
  const filled = isFilled(slot);

  return (
    <button
      type="button"
      onClick={onPick}
      className="hanger-half group relative block h-full w-1/2 bg-white text-left"
      aria-label={`${side} hanger`}
    >
      {filled ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={publicUrlFor(slot!.imagePath!)}
          alt={slot?.label ?? `${side} door hanger`}
          className="h-full w-full object-cover"
        />
      ) : (
        <EmptyHalf />
      )}

      <DieLineOverlay />

      <span className="print-hide pointer-events-none absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
        {side}
      </span>
      <span className="print-hide pointer-events-none absolute inset-0 border-2 border-transparent group-hover:border-primary/60" />
    </button>
  );
}

/**
 * The cut, drawn on top of whatever is underneath.
 *
 * Always on, artwork or not: it is the difference between a leaflet and a
 * door hanger, and a designer who cannot see where the hole goes will put the
 * logo through it.
 */
function DieLineOverlay() {
  const line = dieLine();
  const holeWidthPct = line.holeSize * 100;
  // The hanger is taller than it is wide, so a circle needs its height in the
  // hanger's own proportions rather than the same percentage.
  const holeHeightPct = ((line.holeSize * HANGER_WIDTH_IN) / HANGER_HEIGHT_IN) * 100;
  const slotWidthPct = line.slotWidth * 100;
  const holeTopPct = line.holeCentreY * 100 - holeHeightPct / 2;

  return (
    <span className="pointer-events-none absolute inset-0" aria-hidden>
      <span
        className="absolute rounded-full border-2 border-dashed border-neutral-400"
        style={{
          left: `${(line.holeCentreX - line.holeSize / 2) * 100}%`,
          top: `${holeTopPct}%`,
          width: `${holeWidthPct}%`,
          height: `${holeHeightPct}%`,
        }}
      />
      {/* The slot's sides run from the top edge down to where the circle
          starts — carrying on through it would draw a cut across the hole. */}
      <span
        className="absolute border-x-2 border-dashed border-neutral-400"
        style={{
          left: `${(0.5 - line.slotWidth / 2) * 100}%`,
          top: `${line.slotTop * 100}%`,
          width: `${slotWidthPct}%`,
          height: `${holeTopPct - line.slotTop * 100}%`,
        }}
      />
      {/* The slot is open at the top — that is how the handle gets in. */}
      <span
        className="absolute border-t-2 border-dashed border-neutral-400"
        style={{
          left: `${(0.5 - line.slotWidth / 2) * 100}%`,
          top: `${line.slotTop * 100}%`,
          width: `${slotWidthPct}%`,
        }}
      />
    </span>
  );
}

function EmptyHalf() {
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-2 bg-neutral-50 px-6 text-center">
      <Scissors className="h-6 w-6 text-neutral-400" aria-hidden />
      <span className="text-sm font-medium text-neutral-500">Tap to add artwork</span>
      <span className="text-xs text-neutral-400">
        {HANGER_WIDTH_IN}&Prime; &times; {HANGER_HEIGHT_IN}&Prime;
      </span>
    </span>
  );
}

function EditHalf({
  side,
  slot,
  onClose,
  onDone,
}: {
  side: HangerSide;
  slot: HangerSlot | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const [imagePath, setImagePath] = useState(slot?.imagePath ?? null);
  const [label, setLabel] = useState(slot?.label ?? "");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const other: HangerSide = side === "left" ? "right" : "left";

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const path = `door-hangers/${side}/${uuid()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
      if (uploadError) throw uploadError;
      setImagePath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function run(work: () => Promise<{ ok: boolean; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await work();
      if (result.ok) onDone();
      else setError(result.message ?? "That didn't work.");
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-4 shadow-xl">
        <h2 className="text-lg font-semibold capitalize">{side} half</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          {HANGER_WIDTH_IN}&Prime; &times; {HANGER_HEIGHT_IN}&Prime; ({ARTWORK_PIXEL_WIDTH} &times;{" "}
          {ARTWORK_PIXEL_HEIGHT}px). Nothing important in the top {safeTopIn()}&Prime;.
        </p>

        <div className="space-y-3">
          <div className="flex items-center gap-3">
            {imagePath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={publicUrlFor(imagePath)}
                alt=""
                className="w-16 rounded-md border border-border object-cover"
                style={{ aspectRatio: `${HANGER_WIDTH_IN} / ${HANGER_HEIGHT_IN}` }}
              />
            ) : (
              <div
                className="flex w-16 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
                style={{ aspectRatio: `${HANGER_WIDTH_IN} / ${HANGER_HEIGHT_IN}` }}
              >
                Empty
              </div>
            )}
            <div>
              <input
                id="hanger-art"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => document.getElementById("hanger-art")?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ImageUp className="mr-2 h-4 w-4" />
                )}
                {imagePath ? "Replace" : "Upload"}
              </Button>
            </div>
          </div>

          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="What this design is (Spring cleanup)"
          />

          {error && (
            <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="flex-1"
              disabled={pending || uploading}
              onClick={() => run(() => saveDoorHanger({ side, imagePath, label }))}
            >
              Save
            </Button>
            {imagePath && (
              <Button
                type="button"
                variant="outline"
                disabled={pending || uploading}
                title={`Put this on the ${other} half too`}
                onClick={() =>
                  // The usual case: one design, printed twice, two hangers a
                  // sheet. Copying beats uploading the same file again.
                  run(async () => {
                    const mine = await saveDoorHanger({ side, imagePath, label });
                    if (!mine.ok) return mine;
                    return saveDoorHanger({ side: other, imagePath, label });
                  })
                }
              >
                <Copy className="mr-2 h-4 w-4" />
                Both halves
              </Button>
            )}
            {slot && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => clearDoorHanger(side))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

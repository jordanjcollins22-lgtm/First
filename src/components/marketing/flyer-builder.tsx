"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { ImageUp, Loader2, Printer, Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { clearFlyerAd, saveFlyerAd } from "@/lib/actions/flyer-actions";
import {
  AD_HEIGHT_IN,
  AD_PIXEL_HEIGHT,
  AD_PIXEL_WIDTH,
  AD_WIDTH_IN,
  HOUSE_SLOT,
  SELLABLE_SLOT_COUNT,
  bookedRevenue,
  isFilled,
  nextOpenSlot,
  openSlots,
  slotsForSide,
  type FlyerAd,
  type Side,
} from "@/lib/flyer";
import { EddmIndicia, EmptyAdTile, SupportBanner } from "./flyer-tile";

const BUCKET = "flyer-ads";
const HOUSE_NAME = "JS Landscaping";

function publicUrlFor(path: string): string {
  return createClient().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * The flyer, as it will print, with every square pressable.
 *
 * Two sheets of four squares. One of them is ours and stays ours. The other
 * seven are stock: the sheet is the stock list, because the fastest way to
 * know what is left to sell is to look at the thing being sold.
 */
export function FlyerBuilder({
  ads,
  bookingQrSvg = null,
}: {
  ads: FlyerAd[];
  /** The scan-to-book square, rendered on the server. Null when there is no
   * public link yet, and the empty squares fall back to the phone number. */
  bookingQrSvg?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<number | null>(null);

  const bySlot = new Map(ads.map((ad) => [ad.slot, ad]));
  const open = openSlots(ads);
  const sold = SELLABLE_SLOT_COUNT - open.length;
  const next = nextOpenSlot(ads);
  const revenue = bookedRevenue(ads);

  return (
    <div className="mx-auto max-w-4xl px-4 py-4 sm:py-6">
      <div className="print-hide">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Flyer ad spots</h1>
            <p className="text-sm text-muted-foreground">
              Eight squares over two sides. The front top-right is ours — the other seven are for
              sale on a run that goes out anyway.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" />
            Print
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Sold" value={`${sold} of ${SELLABLE_SLOT_COUNT}`} />
          <Stat label="Booked" value={revenue > 0 ? `$${revenue.toFixed(0)}` : "—"} />
          <Stat label="Next open" value={next ? `#${next.slot}` : "Full"} />
        </div>

        <p className="mt-3 rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-sm text-muted-foreground backdrop-blur-md">
          Artwork is {AD_WIDTH_IN}&Prime; &times; {AD_HEIGHT_IN}&Prime; — send advertisers{" "}
          <span className="font-medium text-foreground">
            {AD_PIXEL_WIDTH} &times; {AD_PIXEL_HEIGHT}px
          </span>{" "}
          for a clean print. Tap any square to fill it.
        </p>

        <p className="mt-2 rounded-lg border border-white/60 bg-card/60 px-3 py-2 text-xs text-muted-foreground backdrop-blur-md">
          Printing: set <span className="font-medium text-foreground">Margins</span> to None and{" "}
          <span className="font-medium text-foreground">Scale</span> to 100%. The sheet is already
          laid out at 8.5&Prime; &times; 11&Prime;, so anything that shrinks it to fit shrinks the
          ad squares with it.
        </p>
      </div>

      {/* Lifted out of the page's flow when printing, so the app's header,
          nav and padding never end up between the sheet and the paper. */}
      <div className="print-root mt-5 space-y-6">
        <Sheet side="front" bySlot={bySlot} bookingQrSvg={bookingQrSvg} onPick={setEditing} />
        <Sheet side="back" bySlot={bySlot} bookingQrSvg={bookingQrSvg} onPick={setEditing} />
      </div>

      {editing != null && (
        <SlotDialog
          slot={editing}
          ad={bySlot.get(editing)}
          onDone={() => {
            setEditing(null);
            router.refresh();
          }}
          onClose={() => setEditing(null)}
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

function Sheet({
  side,
  bySlot,
  bookingQrSvg,
  onPick,
}: {
  side: Side;
  bySlot: Map<number, FlyerAd>;
  bookingQrSvg: string | null;
  onPick: (slot: number) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground print-hide">
        {side === "front" ? "Front — the postage side" : "Back"}
      </p>
      <div
        className="print-sheet relative mx-auto w-full overflow-hidden rounded-lg border border-border bg-white shadow-sm"
        style={{ aspectRatio: "8.5 / 11", containerType: "inline-size" }}
      >
        <div className="flyer-inner flex h-full w-full flex-col p-[2.9%]">
          <div className="flyer-grid grid grid-cols-2 gap-[1.6%]">
            {slotsForSide(side).map((position) => (
              <TileButton
                key={position.slot}
                slot={position.slot}
                forSale={position.forSale}
                ad={bySlot.get(position.slot)}
                bookingQrSvg={bookingQrSvg}
                onPick={onPick}
              />
            ))}
          </div>
          <div className="flyer-banner mt-auto flex items-center pt-[1.6%]">
            <SupportBanner />
          </div>
        </div>
        {side === "front" && <EddmIndicia />}
      </div>
    </div>
  );
}

function TileButton({
  slot,
  forSale,
  ad,
  bookingQrSvg,
  onPick,
}: {
  slot: number;
  forSale: boolean;
  ad: FlyerAd | undefined;
  bookingQrSvg: string | null;
  onPick: (slot: number) => void;
}) {
  const filled = isFilled(ad);

  return (
    <button
      type="button"
      onClick={() => onPick(slot)}
      className="flyer-tile group relative block w-full cursor-pointer bg-white text-left"
      style={{ aspectRatio: `${AD_WIDTH_IN} / ${AD_HEIGHT_IN}`, containerType: "size" }}
      aria-label={filled ? `Square ${slot}: ${ad?.businessName ?? "filled"}` : `Square ${slot}: open`}
    >
      {filled ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={publicUrlFor(ad!.imagePath!)}
          alt={ad?.businessName ?? `Advert in square ${slot}`}
          className="h-full w-full object-cover"
        />
      ) : (
        <EmptyAdTile bookingQrSvg={bookingQrSvg} />
      )}

      {/* Screen-only chrome. None of this reaches the paper. */}
      <span className="print-hide pointer-events-none absolute left-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">
        #{slot}
        {!forSale && " · Ours"}
      </span>
      <span className="print-hide pointer-events-none absolute inset-0 border-2 border-transparent group-hover:border-primary/60" />
    </button>
  );
}

function SlotDialog({
  slot,
  ad,
  onDone,
  onClose,
}: {
  slot: number;
  ad: FlyerAd | undefined;
  onDone: () => void;
  onClose: () => void;
}) {
  const isHouse = slot === HOUSE_SLOT;
  const [businessName, setBusinessName] = useState(ad?.businessName ?? (isHouse ? HOUSE_NAME : ""));
  const [contact, setContact] = useState(ad?.contact ?? "");
  const [price, setPrice] = useState(ad?.price != null ? String(ad.price) : "");
  const [imagePath, setImagePath] = useState(ad?.imagePath ?? null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const path = `slot-${slot}/${uuid()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file);
      if (uploadError) throw uploadError;
      setImagePath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await saveFlyerAd({
        slot,
        businessName,
        contact,
        imagePath,
        price: isHouse || !price.trim() ? null : Number(price),
      });
      if (result.ok) onDone();
      else setError(result.message);
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      const result = await clearFlyerAd(slot);
      if (result.ok) onDone();
      else setError(result.message);
    });
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Square #{slot}
            {isHouse && ` — ${HOUSE_NAME}`}
          </DialogTitle>
          <DialogDescription>
            {isHouse
              ? "Ours, always. The postage indicia prints over this corner, so the artwork has to leave room for it."
              : `Artwork is ${AD_WIDTH_IN}″ × ${AD_HEIGHT_IN}″ (${AD_PIXEL_WIDTH} × ${AD_PIXEL_HEIGHT}px).`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="flyer-art">Artwork</Label>
            <div className="mt-1 flex items-center gap-3">
              {imagePath ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={publicUrlFor(imagePath)}
                  alt=""
                  className="w-20 rounded-md border border-border object-cover"
                  style={{ aspectRatio: `${AD_WIDTH_IN} / ${AD_HEIGHT_IN}` }}
                />
              ) : (
                <div
                  className="flex w-20 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground"
                  style={{ aspectRatio: `${AD_WIDTH_IN} / ${AD_HEIGHT_IN}` }}
                >
                  Empty
                </div>
              )}
              <div className="flex-1">
                <input
                  id="flyer-art"
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
                  onClick={() => document.getElementById("flyer-art")?.click()}
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
          </div>

          <div>
            <Label htmlFor="flyer-business">Business</Label>
            <Input
              id="flyer-business"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              placeholder="Who bought it"
            />
          </div>

          {!isHouse && (
            <>
              <div>
                <Label htmlFor="flyer-contact">Contact</Label>
                <Input
                  id="flyer-contact"
                  value={contact}
                  onChange={(event) => setContact(event.target.value)}
                  placeholder="Phone or email"
                />
              </div>
              <div>
                <Label htmlFor="flyer-price">Price paid</Label>
                <Input
                  id="flyer-price"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  inputMode="decimal"
                  placeholder="150"
                />
              </div>
            </>
          )}

          {error && (
            <p className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-700">{error}</p>
          )}

          <div className="flex gap-2">
            <Button type="button" className="flex-1" disabled={pending || uploading} onClick={save}>
              Save
            </Button>
            {ad && (
              <Button type="button" variant="outline" disabled={pending} onClick={clear}>
                <Trash2 className="mr-2 h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

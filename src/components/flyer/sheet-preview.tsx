"use client";

import { AD_HEIGHT_IN, AD_WIDTH_IN, HOUSE_SLOT, slotsForSide } from "@/lib/flyer";

/**
 * Their advert on the actual flyer, not floating on its own.
 *
 * A tile shown by itself tells somebody nothing about what a neighbour will
 * see. Four squares on a sheet, theirs among them, is the thing that makes a
 * local business understand what they are buying, and it is the moment the
 * sale is made or lost.
 *
 * Front side only. It is the side with the postage on it, it is what lands
 * face up on a doormat, and showing both halves on a phone shrinks each one
 * to the size of a stamp.
 */
export function FlyerSheetPreview({
  artwork,
  businessName,
  isPdf = false,
}: {
  /** Data URL or public URL of their design. Null before they upload. */
  artwork: string | null;
  businessName: string;
  isPdf?: boolean;
}) {
  const front = slotsForSide("front");
  // The first square that is actually for sale. Theirs on the mock-up is the
  // top left, which is where an eye lands.
  const theirs = front.find((s) => s.forSale)?.slot ?? 1;

  return (
    <div className="mx-auto w-full max-w-[240px]">
      <div
        className="relative overflow-hidden rounded-lg border border-border bg-white p-[2.9%] shadow-sm"
        style={{ aspectRatio: "8.5 / 11" }}
      >
        <div className="grid grid-cols-2 gap-[1.6%]">
          {front.map((position) => {
            const mine = position.slot === theirs;
            const house = position.slot === HOUSE_SLOT;
            return (
              <div
                key={position.slot}
                className={`relative overflow-hidden bg-white ${
                  mine ? "ring-2 ring-primary" : ""
                }`}
                style={{ aspectRatio: `${AD_WIDTH_IN} / ${AD_HEIGHT_IN}` }}
              >
                {mine && artwork && !isPdf ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={artwork}
                    alt={`${businessName} advert on the flyer`}
                    className="h-full w-full object-cover"
                  />
                ) : mine ? (
                  <div className="flex h-full w-full items-center justify-center bg-primary/10 p-1 text-center">
                    <span className="text-[7px] font-semibold leading-tight text-primary">
                      {artwork ? businessName || "Your advert" : "Your advert here"}
                    </span>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-muted/40 p-1 text-center">
                    <span className="text-[6px] leading-tight text-muted-foreground">
                      {house ? "Our advert" : "Another local business"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="mt-[1.6%] h-[7%] w-full rounded-sm bg-muted/50" />
      </div>

      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        The front of the flyer. Yours is the highlighted square.
      </p>
    </div>
  );
}

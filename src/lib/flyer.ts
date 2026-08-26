/**
 * The shape of the EDDM flyer, and which of its squares are for sale.
 *
 * Everything about the sheet is fixed by the print: eight tiles, four to a
 * side, each 4" by 4.75". One of them is ours. That leaves seven squares of
 * paper we are already paying postage on, which is the whole reason this
 * file exists — an advert in one of them is money arriving on a run that was
 * going out anyway.
 */

/** Inches. Not a style choice — it is what the artwork has to be cut to. */
export const AD_WIDTH_IN = 4;
export const AD_HEIGHT_IN = 4.75;

/** What an advertiser should send. 300dpi of the printed size. */
export const AD_PIXEL_WIDTH = Math.round(AD_WIDTH_IN * 300);
export const AD_PIXEL_HEIGHT = Math.round(AD_HEIGHT_IN * 300);

/**
 * Ours, and never for sale.
 *
 * Front page, top right. That corner carries the postage indicia, so our
 * artwork is the one cut to leave room for it — moving it would mean redoing
 * the artwork and would put a paying advert under a stamp.
 */
export const HOUSE_SLOT = 2;

/** What the empty squares tell people to ring. */
export const AD_CONTACT_PHONE = "443-819-1521";

export type Side = "front" | "back";

export interface SlotPosition {
  slot: number;
  side: Side;
  /** 0 = top, 1 = bottom. */
  row: 0 | 1;
  /** 0 = left, 1 = right. */
  col: 0 | 1;
  /** False for the house slot. */
  forSale: boolean;
}

/** Every square on the sheet, in reading order: across, then down, then over. */
export const SLOTS: readonly SlotPosition[] = Array.from({ length: 8 }, (_, index) => {
  const slot = index + 1;
  const onBack = slot > 4;
  const withinSide = onBack ? slot - 5 : slot - 1;
  return {
    slot,
    side: onBack ? ("back" as const) : ("front" as const),
    row: (withinSide < 2 ? 0 : 1) as 0 | 1,
    col: (withinSide % 2) as 0 | 1,
    forSale: slot !== HOUSE_SLOT,
  };
});

export const SELLABLE_SLOT_COUNT = SLOTS.filter((s) => s.forSale).length;

export interface FlyerAd {
  id: string;
  slot: number;
  businessName: string | null;
  contact: string | null;
  imagePath: string | null;
  price: number | null;
  notes: string | null;
}

/** The squares on one side, in the order they print. */
export function slotsForSide(side: Side): SlotPosition[] {
  return SLOTS.filter((s) => s.side === side);
}

/**
 * A square counts as sold once there is artwork in it.
 *
 * A name without a picture is a conversation, not a booking — and it is the
 * picture that decides whether the square prints as an advert or as "your ad
 * here", which is the only question the sheet is asking.
 */
export function isFilled(ad: FlyerAd | undefined): boolean {
  return Boolean(ad?.imagePath);
}

/** Squares still showing "your ad here". */
export function openSlots(ads: FlyerAd[]): SlotPosition[] {
  const bySlot = new Map(ads.map((ad) => [ad.slot, ad]));
  return SLOTS.filter((s) => s.forSale && !isFilled(bySlot.get(s.slot)));
}

/**
 * Where the next advert lands.
 *
 * The lowest open square, which is the front page before the back — a first
 * advertiser should get the side people look at. This is the hook the
 * automatic version will call; today somebody presses the square themselves,
 * and it comes out the same.
 */
export function nextOpenSlot(ads: FlyerAd[]): SlotPosition | null {
  return openSlots(ads)[0] ?? null;
}

/** What this run of the flyer has been sold for. */
export function bookedRevenue(ads: FlyerAd[]): number {
  return ads
    .filter((ad) => isFilled(ad) && ad.slot !== HOUSE_SLOT)
    .reduce((sum, ad) => sum + (ad.price ?? 0), 0);
}

/**
 * What the seven squares would bring in at what has actually been charged.
 *
 * Priced off the real average rather than a wish, so an empty flyer reads as
 * nothing rather than as a number somebody made up. Null until one has sold.
 */
export function potentialRevenue(ads: FlyerAd[]): number | null {
  const sold = ads.filter((ad) => isFilled(ad) && ad.slot !== HOUSE_SLOT && ad.price != null);
  if (sold.length === 0) return null;
  const average = sold.reduce((sum, ad) => sum + (ad.price ?? 0), 0) / sold.length;
  return average * SELLABLE_SLOT_COUNT;
}

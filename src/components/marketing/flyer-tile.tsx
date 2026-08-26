import { Star } from "lucide-react";

import { AD_CONTACT_PHONE } from "@/lib/flyer";

const GREEN = "#2f9e33";
const LIGHT_GREEN = "#68bd45";
const CHARCOAL = "#414141";

/**
 * An empty square.
 *
 * This is what prints when nobody has bought the spot, so it has to sell it:
 * it says what the space is, who it reaches, and the number to ring. An empty
 * square that says nothing is postage spent on white paper.
 */
export function EmptyAdTile() {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center bg-white px-[7%] text-center"
      style={{ border: `3px dashed ${GREEN}`, color: CHARCOAL }}
    >
      <MegaphoneMark />

      <p className="text-[13cqw] font-extrabold leading-[0.95] tracking-tight">YOUR AD</p>
      <div className="flex w-full items-center justify-center gap-[4%]">
        <Dashes />
        <p className="text-[13cqw] font-extrabold leading-[0.95] tracking-tight">HERE!</p>
        <Dashes />
      </div>

      <Star className="my-[3%] h-[7%] w-auto" strokeWidth={0} fill={GREEN} aria-hidden />

      <Ribbon />

      <p className="mt-[4%] text-[4.6cqw] leading-snug" style={{ color: CHARCOAL }}>
        Get your business in front of local homeowners.
      </p>
      <p className="mt-[2%] text-[6.6cqw] font-bold" style={{ color: LIGHT_GREEN }}>
        CALL: {AD_CONTACT_PHONE}
      </p>
    </div>
  );
}

/**
 * The megaphone from the artwork.
 *
 * Drawn here rather than taken from the icon set: the icon has no lines
 * coming out of it, and a megaphone with nothing coming out of it is a cone.
 */
function MegaphoneMark() {
  return (
    <svg
      viewBox="0 0 30 24"
      className="mb-[3%] h-[24%] w-auto -rotate-12"
      fill="none"
      aria-hidden
    >
      <path d="m3 11 18-5v12L3 14v-3z" fill={CHARCOAL} />
      <path
        d="M11.6 16.8a3 3 0 1 1-5.8-1.6"
        stroke={CHARCOAL}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
      <g stroke={CHARCOAL} strokeWidth={1.8} strokeLinecap="round">
        <path d="M23 6 27 3" />
        <path d="M23.5 12h4.5" />
        <path d="M23 18 27 21" />
      </g>
    </svg>
  );
}

function Dashes() {
  return (
    <span className="flex shrink-0 flex-col gap-[2px]" aria-hidden>
      <span className="block h-[2px] w-[7cqw]" style={{ background: GREEN }} />
      <span className="block h-[2px] w-[7cqw]" style={{ background: GREEN }} />
    </span>
  );
}

/** The green flag across the middle, notched at both ends like the artwork. */
function Ribbon() {
  return (
    <div
      className="w-[94%] py-[2.5%] text-[4.4cqw] font-bold uppercase tracking-wide text-white"
      style={{
        background: GREEN,
        clipPath: "polygon(0% 0%, 100% 0%, 96% 50%, 100% 100%, 0% 100%, 4% 50%)",
      }}
    >
      Reserve this space today!
    </div>
  );
}

/** The blue strip along the bottom of every sheet. */
export function SupportBanner() {
  return (
    <div
      className="flex w-full flex-col items-center justify-center py-[1.1%] text-center"
      style={{ background: "#2b64b0" }}
    >
      <p className="text-[3.6cqw] font-extrabold uppercase leading-tight text-white">
        Support Local Businesses!
      </p>
      <p className="text-[2.4cqw] font-bold uppercase leading-tight" style={{ color: "#8fd14f" }}>
        Thank you for supporting our community.
      </p>
    </div>
  );
}

/**
 * The postage indicia, top right.
 *
 * Drawn over the corner of our own square rather than beside it — that corner
 * is why the top right is ours and why our artwork is cut to leave room here.
 * A paying advertiser must never end up underneath it.
 */
export function EddmIndicia({ permit }: { permit?: string | null }) {
  return (
    <div
      className="absolute right-[3.4%] top-[1.9%] z-10 bg-white px-[0.7%] py-[0.4%] text-center leading-tight"
      style={{ border: "1px solid #111", color: "#111", width: "15.5%" }}
    >
      <p className="text-[1.35cqw] font-bold uppercase">PRSRT STD</p>
      <p className="text-[1.35cqw] font-bold uppercase">ECRWSS</p>
      <p className="text-[1.35cqw] font-bold uppercase">U.S. Postage</p>
      <p className="text-[1.7cqw] font-extrabold uppercase">Paid</p>
      <p className="text-[1.35cqw] font-bold uppercase">EDDM Retail</p>
      {permit ? <p className="text-[1.2cqw] uppercase">{permit}</p> : null}
    </div>
  );
}

import { shirtArt, shirtColor, shirtDesign, type ShirtSide, type ShirtStyle } from "@/lib/shirts";

/**
 * A shirt, drawn: the chosen style in the chosen colour, with the design's
 * print where it goes and at its printed size (12 drawing units to the inch,
 * on a 20-inch-wide body).
 */
const IN = 12;
const BODY = { left: 80, right: 320, top: 30 };

const SHAPES: Record<ShirtStyle, string> = {
  tee: "M140,30 C170,44 230,44 260,30 L338,56 L396,132 L348,166 L320,146 L320,424 L80,424 L80,146 L52,166 L4,132 L62,56 Z",
  "long-sleeve": "M140,30 C170,44 230,44 260,30 L338,56 L392,330 L352,340 L320,176 L320,424 L80,424 L80,176 L48,340 L8,330 L62,56 Z",
  hoodie: "M140,30 C170,44 230,44 260,30 L338,56 L392,330 L352,340 L320,176 L320,424 L80,424 L80,176 L48,340 L8,330 L62,56 Z",
};

function shade(hex: string, by: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v + by))));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function ShirtMockup({
  design: designKey,
  color: colorKey,
  style = "tee",
  side = "front",
  className,
}: {
  design: string;
  color: string;
  style?: ShirtStyle;
  side?: ShirtSide;
  className?: string;
}) {
  const design = shirtDesign(designKey);
  const color = shirtColor(colorKey);
  if (!design || !color) return null;
  const print = side === "front" ? design.front : design.back;
  const light = parseInt(color.hex.slice(1), 16) > 0xb0b0b0;
  const edge = shade(color.hex, light ? -40 : 28);
  // Left chest is the wearer's left: the right of the picture, seen from the front.
  const chest = print?.art === "chest";
  const width = (print?.widthIn ?? 0) * IN;
  const x = chest ? 252 - width / 2 : 200 - width / 2;
  const y = chest ? 96 : BODY.top + (style === "hoodie" && side === "front" ? 70 : 46);
  return (
    <svg viewBox="0 0 400 440" className={className} role="img" aria-label={`${design.label} ${side}, ${color.label}`}>
      {style === "hoodie" && <path d="M138,32 C140,-6 260,-6 262,32 C240,46 160,46 138,32 Z" fill={shade(color.hex, light ? -18 : 14)} stroke={edge} strokeWidth="2" />}
      <path d={SHAPES[style]} fill={color.hex} stroke={edge} strokeWidth="2" strokeLinejoin="round" />
      {/* Neck: lower at the front than the back. */}
      <path d={side === "front" ? "M140,30 C160,66 240,66 260,30" : "M140,30 C170,44 230,44 260,30"} fill="none" stroke={edge} strokeWidth="3" />
      {style === "hoodie" && side === "front" && (
        <>
          <path d="M184,58 L182,110 M216,58 L218,110" stroke={edge} strokeWidth="2" />
          <path d="M120,300 L280,300 L300,380 L100,380 Z" fill="none" stroke={edge} strokeWidth="2" />
        </>
      )}
      {style !== "tee" && <path d="M80,410 L320,410" stroke={edge} strokeWidth="2" />}
      {/* A soft fold down each side, so it reads as cloth. */}
      <path d="M96,180 C104,260 100,340 104,420 M304,180 C296,260 300,340 296,420" stroke={shade(color.hex, light ? -14 : 10)} strokeWidth="6" fill="none" opacity="0.6" />
      {print && <image href={shirtArt(print, color, "preview")} x={x} y={y} width={width} preserveAspectRatio="xMidYMin meet" />}
    </svg>
  );
}

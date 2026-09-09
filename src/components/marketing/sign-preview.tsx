import { PADDING, type PiecePlan } from "@/lib/poster-pieces";

/**
 * The sign, drawn small, before anybody prints sixteen sheets.
 *
 * The pieces are the same ones the PDF prints, from the same plan, so what is
 * on the screen is what comes out of the printer. Each cutout is drawn as its
 * own shape with the board showing between them, because that is what the
 * finished thing looks like: separate pieces on a board, not a poster.
 *
 * Every line is forced to the width the layout measured with `textLength`.
 * The browser has no Helvetica to hand and would otherwise set each line at
 * its own idea of the width, which is exactly the discrepancy this preview
 * exists to catch.
 */
export function SignPreview({ plan }: { plan: PiecePlan }) {
  const { board, pieces } = plan;
  const qr = pieces.find((p) => p.kind === "qr");

  return (
    <svg
      viewBox={`0 0 ${board.width} ${board.height}`}
      className="h-auto w-full max-w-56 rounded border border-border bg-white"
      role="img"
      aria-label={`The ${board.width} by ${board.height} inch sign, as ${pieces.length} cutouts`}
    >
      <rect width={board.width} height={board.height} fill="#FBFAF7" />
      {pieces.map((piece) => {
        if (piece.kind === "qr") return null;
        const baseline = piece.y + PADDING + piece.fontSize * 0.72;
        return (
          <g key={piece.id}>
            <rect
              x={piece.x}
              y={piece.y}
              width={piece.width}
              height={piece.height}
              fill={piece.fill ?? "#FFFFFF"}
              stroke={piece.fill ? "none" : "#E6E4DF"}
              strokeWidth={0.03}
            />
            <text
              x={piece.x + PADDING}
              y={baseline}
              textLength={piece.width - 2 * PADDING}
              lengthAdjust="spacingAndGlyphs"
              fontFamily="Helvetica, Arial, sans-serif"
              fontWeight="bold"
              fontStyle={piece.italic ? "italic" : undefined}
              fontSize={piece.fontSize}
              fill={piece.colour}
            >
              {piece.text}
            </text>
          </g>
        );
      })}
      {qr && <QrStandIn x={qr.x} y={qr.y} side={qr.width} />}
    </svg>
  );
}

/**
 * A code-shaped square, not a real code.
 *
 * The real one is generated for the booking link when the file is made. A
 * preview only has to say "a code goes here and it is this big", and three
 * corner marks say that to anybody who has ever scanned one.
 */
function QrStandIn({ x, y, side }: { x: number; y: number; side: number }) {
  const unit = side / 9;
  return (
    <g>
      <rect x={x} y={y} width={side} height={side} fill="#FFFFFF" stroke="#E6E4DF" strokeWidth={0.03} />
      {[
        [x + unit, y + unit],
        [x + side - 3 * unit, y + unit],
        [x + unit, y + side - 3 * unit],
      ].map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <rect x={cx} y={cy} width={2 * unit} height={2 * unit} fill="#111111" />
          <rect x={cx + unit * 0.6} y={cy + unit * 0.6} width={0.8 * unit} height={0.8 * unit} fill="#FFFFFF" />
        </g>
      ))}
      <rect x={x + side * 0.45} y={y + side * 0.45} width={side * 0.3} height={side * 0.3} fill="#111111" />
    </g>
  );
}

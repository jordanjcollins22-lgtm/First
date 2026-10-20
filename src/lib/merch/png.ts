// Server only: native renderer.
import { Resvg } from "@resvg/resvg-js";

import { findSvgSize } from "./template";

/** Vendors generally want at least 150 DPI at full size. */
const MIN_DPI = 150;

/**
 * Rasterize a print file. Renders at the design's own pixel size (so an
 * uploaded image keeps its full resolution) or 150 DPI, whichever is larger.
 */
export function renderPrintPng(svg: string): Buffer {
  const size = findSvgSize(svg);
  const width = Math.round(Math.max(size.viewBoxWidth ?? 0, (size.widthIn ?? 0) * MIN_DPI) || 2400);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    font: { loadSystemFonts: true, defaultFontFamily: "Arial" },
  });
  return resvg.render().asPng();
}

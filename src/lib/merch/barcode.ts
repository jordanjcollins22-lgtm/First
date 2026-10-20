// Server only: the barcode engine is large, so client code imports formats.ts instead.
import { toSVG } from "bwip-js/node";

import type { BarcodeFormat } from "@/types/domain";

const LINEAR: BarcodeFormat[] = ["code128", "upca", "ean13"];

export type BarcodeResult = { ok: true; svg: string } | { ok: false; error: string };

/**
 * Render a barcode as vector SVG. Human-readable text is drawn as paths, so
 * the print vendor doesn't need any fonts installed.
 */
export function renderBarcode(format: BarcodeFormat, value: string): BarcodeResult {
  const text = value.trim();
  if (!text) return { ok: false, error: "Enter a barcode value." };
  try {
    const svg = toSVG({
      bcid: format,
      text,
      ...(LINEAR.includes(format) ? { includetext: true, textxalign: "center", height: 12 } : {}),
    });
    return { ok: true, svg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // bwip-js errors look like "bwipp.ean13badLength#6878: EAN-13 must be 12 or 13 digits".
    return { ok: false, error: message.replace(/^[\w.#]+:\s*/, "") };
  }
}

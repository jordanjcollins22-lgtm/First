"use client";

import jsQR from "jsqr";

import type { SlotBox } from "@/lib/merch/template";

export interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
  element: HTMLImageElement;
}

export async function loadImageFile(file: File): Promise<LoadedImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const element = new Image();
  element.src = dataUrl;
  await element.decode();
  return { dataUrl, width: element.naturalWidth, height: element.naturalHeight, element };
}

/** Scanning a full-size print file is slow; this is plenty to find a QR code. */
const DETECT_MAX_SIDE = 1600;

/**
 * Find the placeholder QR code already in the design, so its spot becomes the
 * barcode slot. Returns the box in the image's own pixels, plus what it links to.
 */
export function detectQrCode(image: LoadedImage): { box: SlotBox; data: string } | null {
  const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(image.width, image.height));
  const w = Math.round(image.width * scale);
  const h = Math.round(image.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image.element, 0, 0, w, h);
  const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h);
  if (!found) return null;

  const { topLeftCorner, topRightCorner, bottomLeftCorner, bottomRightCorner } = found.location;
  const xs = [topLeftCorner.x, topRightCorner.x, bottomLeftCorner.x, bottomRightCorner.x];
  const ys = [topLeftCorner.y, topRightCorner.y, bottomLeftCorner.y, bottomRightCorner.y];
  const x = Math.min(...xs) / scale;
  const y = Math.min(...ys) / scale;
  return {
    box: {
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(Math.max(...xs) / scale - x),
      height: Math.round(Math.max(...ys) / scale - y),
    },
    data: found.data,
  };
}

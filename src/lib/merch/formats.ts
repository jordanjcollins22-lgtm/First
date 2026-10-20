import type { BarcodeFormat } from "@/types/domain";

export const BARCODE_FORMATS: { value: BarcodeFormat; label: string; hint: string }[] = [
  { value: "code128", label: "Code 128", hint: "Letters and numbers, e.g. TM-0042" },
  { value: "qrcode", label: "QR code", hint: "Any text or a link" },
  { value: "upca", label: "UPC-A", hint: "11 or 12 digits" },
  { value: "ean13", label: "EAN-13", hint: "12 or 13 digits" },
];

/** A valid value per format, for previews before anyone types one in. */
export const SAMPLE_BARCODE_VALUES: Record<BarcodeFormat, string> = {
  code128: "TM-0001",
  qrcode: "https://example.com",
  upca: "03600029145",
  ean13: "590123412345",
};

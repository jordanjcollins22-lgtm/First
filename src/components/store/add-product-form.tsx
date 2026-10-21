"use client";

import { useMemo, useRef, useState, useTransition } from "react";

import { SELECT_CLASS } from "@/components/team/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createMerchProduct } from "@/lib/actions/merch-actions";
import { BARCODE_FORMATS, SAMPLE_BARCODE_VALUES } from "@/lib/merch/formats";
import {
  BARCODE_SLOT_ID,
  rasterDesignSvg,
  type SlotBox,
} from "@/lib/merch/template";
import type { BarcodeFormat, BarcodeSource } from "@/types/domain";

import { DesignPreview } from "./design-preview";
import { detectQrCode, loadImageFile, type LoadedImage } from "./detect-qr";
import { SlotPicker } from "./slot-picker";
import { useDesignPreview } from "./use-design-preview";

export function AddProductForm() {
  const formRef = useRef<HTMLFormElement>(null);
  // An SVG upload is the template as-is; an image upload becomes one once its slot is marked.
  const [uploadedSvg, setUploadedSvg] = useState("");
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [slot, setSlot] = useState<SlotBox | null>(null);
  const [printWidthIn, setPrintWidthIn] = useState(24);
  const [detectNote, setDetectNote] = useState<string | null>(null);
  const [source, setSource] = useState<BarcodeSource>("affiliate");
  const [format, setFormat] = useState<BarcodeFormat>("code128");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const designSvg = useMemo(() => {
    if (!image) return uploadedSvg;
    if (!slot || !(printWidthIn > 0)) return "";
    return rasterDesignSvg({
      dataUrl: image.dataUrl,
      pixelWidth: image.width,
      pixelHeight: image.height,
      printWidthIn,
      slot,
    });
  }, [image, slot, printWidthIn, uploadedSvg]);

  const preview = useDesignPreview(
    designSvg
      ? {
          designSvg,
          barcodeFormat: format,
          barcodeSource: source,
          barcodeValue: SAMPLE_BARCODE_VALUES[format],
        }
      : null
  );

  function clearDesign() {
    setUploadedSvg("");
    setImage(null);
    setSlot(null);
    setDetectNote(null);
  }

  async function loadFile(file: File | undefined) {
    clearDesign();
    if (!file) return;
    if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
      setUploadedSvg(await file.text());
      return;
    }
    const loaded = await loadImageFile(file);
    setImage(loaded);
    const found = detectQrCode(loaded);
    if (found) {
      setSlot(found.box);
      setDetectNote(
        `Found the QR code in your design (it currently links to ${found.data}). Each order replaces it. Drag on the image to adjust.`
      );
    } else {
      setDetectNote("Couldn't find a QR code in the image. Drag a box where the barcode should go.");
    }
  }

  function handleSubmit(formData: FormData) {
    formData.set("design_svg", designSvg);
    startTransition(async () => {
      const result = await createMerchProduct(formData);
      setError(result.error ?? null);
      if (!result.error) {
        formRef.current?.reset();
        clearDesign();
      }
    });
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Item name</Label>
          <Input id="name" name="name" required placeholder="Truck Door Magnet" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="price">Price per item ($)</Label>
          <Input id="price" name="price" type="number" min={0} step="0.01" placeholder="8.00" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vendor_name">Print vendor</Label>
          <Input id="vendor_name" name="vendor_name" placeholder="Sticker Mule, VistaPrint, local shop..." />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="vendor_sku">Vendor product / SKU</Label>
          <Input id="vendor_sku" name="vendor_sku" placeholder="Optional" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="barcode_source">Barcode</Label>
          <select
            id="barcode_source"
            name="barcode_source"
            className={SELECT_CLASS}
            value={source}
            onChange={(e) => setSource(e.target.value as BarcodeSource)}
          >
            <option value="affiliate">Buyer&apos;s affiliate QR code</option>
            <option value="custom">Typed in when ordering</option>
          </select>
        </div>
        {source === "custom" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="barcode_format">Barcode type</Label>
            <select
              id="barcode_format"
              name="barcode_format"
              className={SELECT_CLASS}
              value={format}
              onChange={(e) => setFormat(e.target.value as BarcodeFormat)}
            >
              {BARCODE_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}: {f.hint}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="print_specs">Print specs</Label>
          <Input id="print_specs" name="print_specs" placeholder='24" x 12" vehicle magnet, 30 mil, UV-laminated' />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" name="description" rows={2} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="design_file">Design (PNG, JPG or SVG)</Label>
        <Input
          id="design_file"
          type="file"
          accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
          onChange={(e) => loadFile(e.target.files?.[0])}
        />
        <p className="text-xs text-muted-foreground">
          Easiest: upload the finished design as a PNG with any placeholder QR code where the real one goes.
          The app finds it and swaps in each buyer&apos;s code. For SVGs, put a rectangle with the ID{" "}
          <code>{BARCODE_SLOT_ID}</code> where the barcode goes. The barcode is the only thing that changes
          per person; the phone number and everything else print as designed.
        </p>
      </div>

      {image && (
        <div className="flex flex-col gap-3">
          <SlotPicker src={image.dataUrl} width={image.width} height={image.height} box={slot} onChange={setSlot} />
          {detectNote && <p className="text-sm text-muted-foreground">{detectNote}</p>}
          <div className="flex items-center gap-2">
            <Label htmlFor="print_width_in">Print width (inches)</Label>
            <Input
              id="print_width_in"
              type="number"
              min={1}
              step="0.25"
              className="w-24"
              value={printWidthIn}
              onChange={(e) => setPrintWidthIn(Number(e.target.value))}
            />
            <span className="text-sm text-muted-foreground">
              × {((printWidthIn * image.height) / image.width || 0).toFixed(2)} in ·{" "}
              {Math.round(image.width / (printWidthIn || 1))} DPI
            </span>
          </div>
        </div>
      )}

      {designSvg && (
        <div className="flex flex-col gap-2">
          {preview.error ? (
            <p className="text-sm text-destructive">{preview.error}</p>
          ) : (
            preview.svg && <DesignPreview svg={preview.svg} alt="Design preview" className="max-w-md" />
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={isPending || !designSvg} className="self-start">
        {isPending ? "Saving..." : "Add to store"}
      </Button>
    </form>
  );
}

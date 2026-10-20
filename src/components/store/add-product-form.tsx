"use client";

import { useRef, useState, useTransition } from "react";

import { SELECT_CLASS } from "@/components/team/constants";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createMerchProduct } from "@/lib/actions/merch-actions";
import { BARCODE_FORMATS, SAMPLE_BARCODE_VALUES } from "@/lib/merch/formats";
import { BARCODE_SLOT_ID, sampleFieldValues, templateFields } from "@/lib/merch/template";
import type { BarcodeFormat, BarcodeSource } from "@/types/domain";

import { DesignPreview } from "./design-preview";
import { useDesignPreview } from "./use-design-preview";

export function AddProductForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [designSvg, setDesignSvg] = useState("");
  const [source, setSource] = useState<BarcodeSource>("affiliate");
  const [format, setFormat] = useState<BarcodeFormat>("code128");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const preview = useDesignPreview(
    designSvg
      ? {
          designSvg,
          barcodeFormat: format,
          barcodeSource: source,
          barcodeValue: SAMPLE_BARCODE_VALUES[format],
          values: sampleFieldValues(designSvg),
        }
      : null
  );
  const fields = designSvg ? templateFields(designSvg) : [];

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setDesignSvg(await file.text());
  }

  function handleSubmit(formData: FormData) {
    formData.set("design_svg", designSvg);
    startTransition(async () => {
      const result = await createMerchProduct(formData);
      setError(result.error ?? null);
      if (!result.error) {
        formRef.current?.reset();
        setDesignSvg("");
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
        <Label htmlFor="design_file">Design (SVG)</Label>
        <Input
          id="design_file"
          type="file"
          accept=".svg,image/svg+xml"
          onChange={(e) => loadFile(e.target.files?.[0])}
        />
        <p className="text-xs text-muted-foreground">
          Export your design as SVG at its real print size (e.g. width=&quot;24in&quot;). Put a rectangle with
          the ID <code>{BARCODE_SLOT_ID}</code> where the barcode goes. Any text like <code>{"{{name}}"}</code>{" "}
          becomes a field people fill in when they order.
        </p>
      </div>

      {designSvg && (
        <div className="flex flex-col gap-2">
          {preview.error ? (
            <p className="text-sm text-destructive">{preview.error}</p>
          ) : (
            preview.svg && <DesignPreview svg={preview.svg} alt="Design preview" className="max-w-md" />
          )}
          <p className="text-xs text-muted-foreground">
            Order form fields: {fields.length ? fields.map((f) => f.label).join(", ") : "barcode only"}
          </p>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" disabled={isPending || !designSvg} className="self-start">
        {isPending ? "Saving..." : "Add to store"}
      </Button>
    </form>
  );
}

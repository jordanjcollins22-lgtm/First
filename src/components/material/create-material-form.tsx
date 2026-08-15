"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { v4 as uuid } from "uuid";
import { ImageUp, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { createMaterial } from "@/lib/actions/material-actions";
import { fetchLinkPreview } from "@/lib/actions/link-preview-actions";
import { StorageLocationSelect } from "@/components/inventory/storage-location-select";
import { derivedCostPerUnit } from "@/lib/pricing";

export function CreateMaterialForm({ storageLocations }: { storageLocations: string[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const purchaseUrlRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [quantityValue, setQuantityValue] = useState("");
  const [stockMethod, setStockMethod] = useState<"in_stock" | "order_as_needed">("in_stock");
  const [storageLocation, setStorageLocation] = useState("");
  const [packSize, setPackSize] = useState("");
  const [packCost, setPackCost] = useState("");
  const [isPending, startTransition] = useTransition();
  const [fetching, setFetching] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A pack price divides down to the per-unit number quoting actually uses.
  const derivedPerUnit = derivedCostPerUnit(
    packSize.trim() ? Number(packSize) : null,
    packCost.trim() ? Number(packCost) : null,
    null
  );

  const locationRequired = stockMethod === "in_stock";

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setPreviewUrl(picked ? URL.createObjectURL(picked) : null);
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    if (!file) {
      setError("Add a photo of the material.");
      return;
    }
    startTransition(async () => {
      try {
        const supabase = createClient();
        const path = `${uuid()}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("material-images")
          .upload(path, file, { upsert: false });
        if (uploadError) throw new Error("Couldn't upload the photo — try again.");
        formData.set("image_path", path);
        formData.set("stock_method", stockMethod);
        await createMaterial(formData);
        formRef.current?.reset();
        setFile(null);
        setPreviewUrl(null);
        setQuantityValue("");
        setStockMethod("in_stock");
        setStorageLocation("");
        setPackSize("");
        setPackCost("");
        setFetchMessage(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  async function handleFetchDetails() {
    const url = purchaseUrlRef.current?.value.trim();
    if (!url) {
      setFetchMessage("Paste a purchase link first.");
      return;
    }
    setFetching(true);
    setFetchMessage(null);
    try {
      const preview = await fetchLinkPreview(url);
      const found: string[] = [];
      if (preview.title && nameRef.current && !nameRef.current.value.trim()) {
        nameRef.current.value = preview.title;
        found.push("name");
      }
      if (preview.price != null && costRef.current) {
        costRef.current.value = preview.price.toString();
        found.push("cost");
      }
      if (preview.description && descriptionRef.current) {
        descriptionRef.current.value = preview.description;
        found.push("description");
      }
      const missing: string[] = [];
      if (preview.price == null) missing.push("price");
      if (!preview.description) missing.push("description");

      const parts: string[] = [];
      if (found.length > 0) parts.push(`Filled in ${found.join(", ")} from the link.`);
      if (missing.length > 0) parts.push(`Couldn't find ${missing.join(" or ")} — enter manually.`);
      setFetchMessage(parts.length > 0 ? parts.join(" ") : "Couldn't find anything useful from that link.");
    } catch {
      setFetchMessage("Couldn't reach that link — enter details manually.");
    } finally {
      setFetching(false);
    }
  }

  return (
    <form ref={formRef} action={handleSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Image *</Label>
          <div className="flex items-center gap-2">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="h-12 w-12 rounded-md border border-border object-cover" />
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-destructive/50 text-muted-foreground hover:bg-accent"
              >
                <ImageUp className="h-4 w-4" />
                <span className="text-[9px]">Add</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-name">Name</Label>
          <Input id="material-name" name="name" ref={nameRef} required placeholder="Pea Gravel" className="w-40" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-unit">Unit</Label>
          <Input id="material-unit" name="unit" required placeholder="cubic yards" className="w-32" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-coverage">Sq ft per unit</Label>
          <Input
            id="material-coverage"
            name="coverage_per_unit_sqft"
            type="number"
            step="0.1"
            min={0}
            placeholder="100"
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-waste">Waste %</Label>
          <Input
            id="material-waste"
            name="waste_factor_pct"
            type="number"
            step="0.1"
            min={0}
            placeholder="10"
            className="w-24"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-pack-size">Bought as a pack of</Label>
          <Input
            id="material-pack-size"
            name="pack_size"
            type="number"
            step="1"
            min={0}
            placeholder="25"
            value={packSize}
            onChange={(e) => setPackSize(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-pack-cost">Pack cost</Label>
          <Input
            id="material-pack-cost"
            name="pack_cost"
            type="number"
            step="0.01"
            min={0}
            placeholder="0.00"
            value={packCost}
            onChange={(e) => setPackCost(e.target.value)}
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-cost">Cost / unit</Label>
          {derivedPerUnit != null ? (
            <div className="flex h-11 w-28 items-center rounded-md border border-input bg-muted/50 px-3 text-base">
              ${derivedPerUnit.toFixed(2)}
            </div>
          ) : (
            <Input
              id="material-cost"
              name="cost_per_unit"
              ref={costRef}
              type="number"
              step="0.01"
              min={0}
              placeholder="0.00"
              className="w-28"
            />
          )}
          {derivedPerUnit != null && <span className="text-[10px] text-muted-foreground">From the pack price</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-quantity">On hand</Label>
          <Input
            id="material-quantity"
            name="quantity_on_hand"
            type="number"
            step="0.1"
            min={0}
            placeholder="0"
            value={quantityValue}
            onChange={(e) => setQuantityValue(e.target.value)}
            className="w-24"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-reorder">Reorder at</Label>
          <Input
            id="material-reorder"
            name="reorder_threshold"
            type="number"
            step="0.1"
            min={0}
            placeholder="0"
            className="w-24"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-stock-method">In stock or order it?</Label>
          <Select value={stockMethod} onValueChange={(v) => setStockMethod(v as "in_stock" | "order_as_needed")}>
            <SelectTrigger id="material-stock-method" className="h-11 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="in_stock">In stock at warehouse</SelectItem>
              <SelectItem value="order_as_needed">Order as needed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Stored at{locationRequired && " *"}</Label>
          <input type="hidden" name="storage_location" value={storageLocation} />
          <StorageLocationSelect
            locations={storageLocations}
            value={storageLocation}
            onChange={setStorageLocation}
            className="w-36"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-shop-location">Where in the shop</Label>
          <Input
            id="material-shop-location"
            name="shop_location"
            placeholder="e.g. Yard shelf 2"
            className="w-36"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-purchase-url">Purchase link</Label>
          <div className="flex gap-2">
            <Input
              id="material-purchase-url"
              name="purchase_url"
              ref={purchaseUrlRef}
              type="url"
              placeholder="https://..."
              className="w-64"
            />
            <Button type="button" variant="secondary" disabled={fetching} onClick={handleFetchDetails}>
              <Search className="h-4 w-4" />
              {fetching ? "Fetching..." : "Fetch details"}
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="material-description">Description</Label>
          <Textarea
            id="material-description"
            name="description"
            ref={descriptionRef}
            placeholder="Autofilled from the link, or type your own"
            className="h-11 w-72"
          />
        </div>
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" name="is_delivered" className="h-4 w-4" />
          Delivered to us?
        </label>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding..." : "Add Material"}
        </Button>
      </div>
      {fetchMessage && <p className="text-xs text-muted-foreground">{fetchMessage}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

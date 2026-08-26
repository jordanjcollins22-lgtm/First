"use client";

import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { v4 as uuid } from "uuid";
import { ImageUp, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KitPicker } from "./kit-picker";
import { StorageLocationSelect } from "@/components/inventory/storage-location-select";
import type { ToolCategory } from "@/types/domain";
import { createClient } from "@/lib/supabase/client";
import { createTool } from "@/lib/actions/tool-actions";
import { fetchLinkPreview } from "@/lib/actions/link-preview-actions";

export function CreateToolForm({
  availableKits,
  storageLocations,
  category = "tool",
  onCreated,
}: {
  availableKits: number[];
  storageLocations: string[];
  /** Told what was just added, for callers that need to do something with it
   * — the knowledge graph connects it to the idea that needed it. */
  onCreated?: (item: { id: string; name: string }) => void;
  /** Which tab this form feeds — gear and tools share one table. */
  category?: ToolCategory;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const purchaseUrlRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ownership, setOwnership] = useState<"own" | "rent">("own");
  const [kits, setKits] = useState<number[]>([]);
  const [quantityValue, setQuantityValue] = useState("");
  const [stockMethod, setStockMethod] = useState<"in_stock" | "order_as_needed">("in_stock");
  const [storageLocation, setStorageLocation] = useState("");
  const [isPending, startTransition] = useTransition();
  const [fetching, setFetching] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const locationRequired = stockMethod === "in_stock";

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    setFile(picked);
    setPreviewUrl(picked ? URL.createObjectURL(picked) : null);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    // A plain onSubmit rather than the <form action> prop — React resets a
    // form's uncontrolled fields the instant an action-bound submit starts,
    // before this function even runs, which was wiping everything the
    // evaluator typed the moment they hit a validation problem (missing
    // photo, missing name, etc.) instead of just showing the error.
    e.preventDefault();
    setError(null);

    const formData = new FormData(e.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    if (!name) {
      setError("Enter a tool name.");
      return;
    }
    if (locationRequired && !String(formData.get("storage_location") ?? "").trim()) {
      setError("Enter where it's stored — required for tools kept in stock.");
      return;
    }
    if (!file) {
      setError("Add a photo of the tool.");
      return;
    }

    startTransition(async () => {
      try {
        const supabase = createClient();
        const path = `${uuid()}/${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("tool-images")
          .upload(path, file, { upsert: false });
        if (uploadError) throw new Error("Couldn't upload the photo — try again.");
        formData.set("image_path", path);
        formData.set("is_rental", ownership === "rent" ? "on" : "");
        formData.set("kits", kits.join(","));
        formData.set("stock_method", stockMethod);
        const result = await createTool(formData);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onCreated?.({ id: result.id, name: result.name });
        formRef.current?.reset();
        setFile(null);
        setPreviewUrl(null);
        setOwnership("own");
        setKits([]);
        setQuantityValue("");
        setStockMethod("in_stock");
        setStorageLocation("");
        setFetchMessage(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "";
        setError(message || "Couldn't add that tool — try again.");
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
      setFetchMessage(
        found.length > 0
          ? `Filled in ${found.join(", ")} from the link.`
          : "Couldn't find a price automatically — enter it manually."
      );
    } catch {
      setFetchMessage("Couldn't reach that link — enter details manually.");
    } finally {
      setFetching(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="category" value={category} />
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
          <Label htmlFor="tool-name">Name</Label>
          <Input id="tool-name" name="name" ref={nameRef} required placeholder={category === "gear" ? "Safety glasses" : "Chainsaw"} className="w-44" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Kit(s)</Label>
          <KitPicker availableKits={availableKits} value={kits} onChange={setKits} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-own-rent">Own or Rent</Label>
          <Select value={ownership} onValueChange={(v) => setOwnership(v as "own" | "rent")}>
            <SelectTrigger id="tool-own-rent" className="h-11 w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="own">Own</SelectItem>
              <SelectItem value="rent">Rent</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-cost">
            {ownership === "rent" ? <span className="text-primary">Cost (per day)</span> : "Cost"}
          </Label>
          <Input
            id="tool-cost"
            name="cost"
            ref={costRef}
            type="number"
            step="0.01"
            min={0}
            placeholder={ownership === "rent" ? "0.00 / day" : "0.00"}
            className="w-28"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-stock-method">In stock or order it?</Label>
          <Select value={stockMethod} onValueChange={(v) => setStockMethod(v as "in_stock" | "order_as_needed")}>
            <SelectTrigger id="tool-stock-method" className="h-11 w-44">
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
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-shop-location">Where in the shop</Label>
          <Input
            id="tool-shop-location"
            name="shop_location"
            placeholder="e.g. Shelf 3, Bin B"
            className="w-40"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-quantity">On hand</Label>
          <Input
            id="tool-quantity"
            name="quantity"
            type="number"
            step="1"
            min={0}
            placeholder="0"
            value={quantityValue}
            onChange={(e) => setQuantityValue(e.target.value)}
            className="w-20"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-reorder">Reorder at</Label>
          <Input
            id="tool-reorder"
            name="reorder_threshold"
            type="number"
            step="1"
            min={0}
            placeholder="0"
            className="w-24"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tool-purchase-url">Purchase link</Label>
          <div className="flex gap-2">
            <Input
              id="tool-purchase-url"
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
        <label className="flex items-center gap-1.5 pb-2 text-sm">
          <input type="checkbox" name="is_delivered" className="h-4 w-4" />
          Delivered to us?
        </label>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding..." : category === "gear" ? "Add Gear" : "Add Tool"}
        </Button>
      </div>
      {fetchMessage && <p className="text-xs text-muted-foreground">{fetchMessage}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

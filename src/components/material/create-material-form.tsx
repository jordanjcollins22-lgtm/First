"use client";

import { useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createMaterial } from "@/lib/actions/material-actions";
import { fetchLinkPreview } from "@/lib/actions/link-preview-actions";

export function CreateMaterialForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const costRef = useRef<HTMLInputElement>(null);
  const purchaseUrlRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [isPending, startTransition] = useTransition();
  const [fetching, setFetching] = useState(false);
  const [fetchMessage, setFetchMessage] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      await createMaterial(formData);
      formRef.current?.reset();
      setFetchMessage(null);
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
          <Label htmlFor="material-cost">Cost / unit</Label>
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
          <Label htmlFor="material-storage">Stored at</Label>
          <Input
            id="material-storage"
            name="storage_location"
            placeholder="e.g. Yard bin 2, Shed"
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
        <Button type="submit" disabled={isPending}>
          {isPending ? "Adding..." : "Add Material"}
        </Button>
      </div>
      {fetchMessage && <p className="text-xs text-muted-foreground">{fetchMessage}</p>}
    </form>
  );
}

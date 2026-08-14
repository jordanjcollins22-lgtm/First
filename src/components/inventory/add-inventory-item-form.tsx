"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createTool } from "@/lib/actions/tool-actions";
import { createMaterial } from "@/lib/actions/material-actions";

export interface CreatedInventoryItem {
  kind: "tool" | "material";
  id: string;
  name: string;
}

export function AddInventoryItemForm({
  onCreated,
  onCancel,
}: {
  onCreated: (item: CreatedInventoryItem) => void;
  onCancel?: () => void;
}) {
  const [kind, setKind] = useState<"tool" | "material">("tool");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [cost, setCost] = useState("");
  const [ownership, setOwnership] = useState<"own" | "rent">("own");
  const [stockMethod, setStockMethod] = useState<"in_stock" | "order_as_needed">("in_stock");
  const [storageLocation, setStorageLocation] = useState("");
  const [shopLocation, setShopLocation] = useState("");
  const [isDelivered, setIsDelivered] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locationRequired = stockMethod === "in_stock";

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Enter a name.");
      return;
    }
    if (kind === "material" && !unit.trim()) {
      setError("Enter a unit (e.g. cubic yards, bags).");
      return;
    }
    if (locationRequired && !storageLocation.trim()) {
      setError("Enter where it's stored — required for items kept in stock.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set("name", name.trim());
      formData.set("cost", cost.trim());
      formData.set("stock_method", stockMethod);
      formData.set("storage_location", storageLocation.trim());
      formData.set("shop_location", shopLocation.trim());
      formData.set("is_delivered", isDelivered ? "on" : "");

      if (kind === "tool") {
        formData.set("is_rental", ownership === "rent" ? "on" : "");
        const created = await createTool(formData);
        onCreated({ kind: "tool", id: created.id, name: created.name });
      } else {
        formData.set("unit", unit.trim());
        formData.set("cost_per_unit", cost.trim());
        const created = await createMaterial(formData);
        onCreated({ kind: "material", id: created.id, name: created.name });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-col gap-1.5">
        <Label>Is this a tool or a material?</Label>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant={kind === "tool" ? "default" : "outline"} onClick={() => setKind("tool")}>
            Tool
          </Button>
          <Button
            type="button"
            size="sm"
            variant={kind === "material" ? "default" : "outline"}
            onClick={() => setKind("material")}
          >
            Material
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={kind === "tool" ? "e.g. Chainsaw" : "e.g. Pea Gravel"}
            className="w-44"
            autoFocus
          />
        </div>
        {kind === "material" && (
          <div className="flex flex-col gap-1.5">
            <Label>Unit</Label>
            <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="cubic yards" className="w-32" />
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <Label>Cost</Label>
          <Input
            type="number"
            step="0.01"
            min={0}
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="0.00"
            className="w-24"
          />
        </div>
        {kind === "tool" && (
          <div className="flex flex-col gap-1.5">
            <Label>Own or Rent</Label>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={ownership === "own" ? "default" : "outline"} onClick={() => setOwnership("own")}>
                Own
              </Button>
              <Button type="button" size="sm" variant={ownership === "rent" ? "default" : "outline"} onClick={() => setOwnership("rent")}>
                Rent
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Is it stored at our warehouse, or do we have to order it?</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={stockMethod === "in_stock" ? "default" : "outline"}
            onClick={() => setStockMethod("in_stock")}
          >
            In stock at warehouse
          </Button>
          <Button
            type="button"
            size="sm"
            variant={stockMethod === "order_as_needed" ? "default" : "outline"}
            onClick={() => setStockMethod("order_as_needed")}
          >
            Order as needed
          </Button>
        </div>
      </div>

      {locationRequired && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Stored at *</Label>
            <Input
              value={storageLocation}
              onChange={(e) => setStorageLocation(e.target.value)}
              placeholder="e.g. Shop, Truck 1"
              className="w-40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Where in the shop</Label>
            <Input
              value={shopLocation}
              onChange={(e) => setShopLocation(e.target.value)}
              placeholder="e.g. Shelf 3, Bin B"
              className="w-40"
            />
          </div>
        </div>
      )}

      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={isDelivered}
          onChange={(e) => setIsDelivered(e.target.checked)}
          className="h-4 w-4"
        />
        Do we get it delivered to us?
      </label>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="button" disabled={saving} onClick={handleSubmit}>
          {saving ? "Adding..." : `Add ${kind === "tool" ? "tool" : "material"}`}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

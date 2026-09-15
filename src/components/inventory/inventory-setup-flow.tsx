"use client";

import { useState } from "react";
import Link from "next/link";

import { AddInventoryItemForm, type CreatedInventoryItem } from "./add-inventory-item-form";

export function InventorySetupFlow({ storageLocations }: { storageLocations: string[] }) {
  const [added, setAdded] = useState<CreatedInventoryItem[]>([]);
  const [formKey, setFormKey] = useState(0);

  function handleCreated(item: CreatedInventoryItem) {
    setAdded((prev) => [...prev, item]);
    setFormKey((k) => k + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      {added.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Added so far ({added.length})</p>
          <ul className="flex flex-col gap-1 text-sm">
            {added.map((item, i) => (
              <li key={i}>
                {item.kind === "tool" ? "🧰" : "📦"} {item.name}
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddInventoryItemForm key={formKey} onCreated={handleCreated} storageLocations={storageLocations} />

      <Link
        href="/admin/tools"
        className="text-sm text-muted-foreground underline-offset-2 hover:text-primary hover:underline"
      >
        I&apos;m done for now →
      </Link>
    </div>
  );
}

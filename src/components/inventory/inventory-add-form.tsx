"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { CreateMaterialForm } from "@/components/material/create-material-form";
import { CreateToolForm } from "@/components/tool/create-tool-form";
import type { InventoryGroup } from "@/lib/inventory-groups";

export type InventoryKind = "tool" | "material" | "other";

const KINDS: { value: InventoryKind; label: string; hint: string }[] = [
  { value: "tool", label: "Tool", hint: "Kept and used again" },
  { value: "material", label: "Material", hint: "Used up, reordered" },
  { value: "other", label: "Other", hint: "A cost — a fee, a permit" },
];

/**
 * The one way to put something into inventory.
 *
 * Every tab that adds stock goes through here, and so does the knowledge
 * graph. That is the point: two ways to add a material is how half an
 * inventory ends up with no storage location and no reorder point, and a
 * change to the form has to be made twice and gets made once.
 *
 * The kind is asked rather than assumed from which tab somebody happened to
 * open. A tool bought from the marketing budget is still a tool, and being on
 * the Marketing tab should not decide that for them.
 */
export function InventoryAddForm({
  group,
  storageLocations,
  availableKits,
  defaultKind,
  onCreated,
}: {
  /** Which list it lands on. Separate from what it is. */
  group: InventoryGroup;
  storageLocations: string[];
  availableKits: number[];
  defaultKind?: InventoryKind;
  onCreated?: (item: { id: string; name: string; kind: "material" | "tool" }) => void;
}) {
  const [kind, setKind] = useState<InventoryKind>(
    defaultKind ?? (group === "tools" || group === "gear" ? "tool" : "material")
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">What is it?</Label>
        <div className="grid grid-cols-3 gap-2">
          {KINDS.map((option) => {
            const on = kind === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setKind(option.value)}
                className={`rounded-lg border p-2 text-left ${
                  on ? "border-primary bg-primary/10" : "border-border"
                }`}
              >
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-[11px] text-muted-foreground">{option.hint}</span>
              </button>
            );
          })}
        </div>
        {kind === "other" && (
          <p className="text-[11px] text-muted-foreground">
            A cost with nothing behind it. It gets no resale value, because there is nothing to sell.
          </p>
        )}
        {kind !== "other" && (
          <p className="text-[11px] text-muted-foreground">
            Worth about a tenth of what it cost if we ever sell it — unless it is rented, in which case it
            was never ours.
          </p>
        )}
      </div>

      {kind === "tool" ? (
        <CreateToolForm
          key={`${group}-tool`}
          availableKits={availableKits}
          storageLocations={storageLocations}
          category={group === "gear" ? "gear" : "tool"}
          onCreated={(item) => onCreated?.({ ...item, kind: "tool" })}
        />
      ) : (
        <CreateMaterialForm
          key={`${group}-${kind}`}
          storageLocations={storageLocations}
          category={group === "marketing" ? "marketing" : "job"}
          kind={kind}
          onCreated={(item) => onCreated?.({ ...item, kind: "material" })}
        />
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import { InventoryKindChoice, type InventoryKind } from "@/components/inventory/inventory-kind-choice";
import { CreateMaterialForm } from "@/components/material/create-material-form";
import { CreateToolForm } from "@/components/tool/create-tool-form";
import type { InventoryGroup } from "@/lib/inventory-groups";

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
  /** Told what was added, and what kind somebody said it was — the graph
   * derives how it is charged from that rather than asking again. */
  onCreated?: (item: {
    id: string;
    name: string;
    table: "material" | "tool";
    kind: InventoryKind;
  }) => void;
}) {
  const [kind, setKind] = useState<InventoryKind>(
    defaultKind ?? (group === "tools" || group === "gear" ? "tool" : "material")
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">What is it?</Label>
        <InventoryKindChoice value={kind} onChange={setKind} />
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
          onCreated={(item) => onCreated?.({ ...item, table: "tool", kind })}
        />
      ) : (
        <CreateMaterialForm
          key={`${group}-${kind}`}
          storageLocations={storageLocations}
          category={group === "marketing" ? "marketing" : "job"}
          kind={kind}
          onCreated={(item) => onCreated?.({ ...item, table: "material", kind })}
        />
      )}
    </div>
  );
}

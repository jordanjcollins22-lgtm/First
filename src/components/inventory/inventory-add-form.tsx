"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InventoryWizard } from "@/components/inventory/inventory-wizard";
import type { InventoryKind } from "@/components/inventory/inventory-kind-choice";
import type { InventoryGroup } from "@/lib/inventory-groups";

/**
 * The one way to put something into inventory.
 *
 * Every tab that adds stock goes through here, and so does the knowledge
 * graph. That is the point: two ways to add a material is how half an
 * inventory ends up with no storage location and no reorder point, and a
 * change to it has to be made twice and gets made once.
 *
 * It opens a wizard rather than showing a form. Fourteen fields at once on a
 * phone is how the same three get skipped every time — and those three are
 * where it lives, how many there are, and when to buy more, which is most of
 * what an inventory is for.
 */
export function InventoryAddForm({
  group,
  storageLocations,
  availableKits,
  onCreated,
}: {
  /** Which list it lands on. Separate from what it is. */
  group: InventoryGroup;
  storageLocations: string[];
  availableKits: number[];
  onCreated?: (item: {
    id: string;
    name: string;
    table: "material" | "tool";
    kind: InventoryKind;
  }) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        Add to Inventory
      </Button>
      <p className="mt-2 text-[11px] text-muted-foreground">
        One question at a time, so nothing gets left blank.
      </p>

      <InventoryWizard
        group={group}
        storageLocations={storageLocations}
        availableKits={availableKits}
        open={open}
        onOpenChange={setOpen}
        onCreated={onCreated}
      />
    </>
  );
}

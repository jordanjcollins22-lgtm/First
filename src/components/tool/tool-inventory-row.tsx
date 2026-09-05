"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { ToolImageThumb } from "./tool-image-thumb";
import { ToolImageUpload } from "./tool-image-upload";
import { ToolKitsInput } from "./tool-kits-input";
import { ToolCostInput } from "./tool-cost-input";
import { ResaleCell } from "@/components/inventory/resale-cell";
import { ToolQuantityInput } from "./tool-quantity-input";
import { ToolReorderThresholdInput } from "./tool-reorder-threshold-input";
import { ToolOrderStatus } from "./tool-order-status";
import { ToolOwnershipSelect } from "./tool-ownership-select";
import { ToolCategorySelect } from "./tool-category-select";
import { ToolStorageLocationInput } from "./tool-storage-location-input";
import { ToolShopLocationInput } from "./tool-shop-location-input";
import { ToolPurchaseLinkInput } from "./tool-purchase-link-input";
import { ToolNotOwnedReasonInput } from "./tool-not-owned-reason-input";
import { ToolCostToOwnInput } from "./tool-cost-to-own-input";
import { ToolBuyLink } from "./tool-buy-link";
import { ToolServiceToggles } from "./tool-service-toggles";
import { DeactivateToolButton } from "./deactivate-tool-button";
import type { Tool } from "@/types/domain";

interface ToolInventoryRowProps {
  tool: Tool;
  serviceTypes: { id: string; label: string }[];
  linkedServiceTypeIds: string[];
  availableKits: number[];
  storageLocations: string[];
}

export function ToolInventoryRow({
  tool,
  serviceTypes,
  linkedServiceTypeIds,
  availableKits,
  storageLocations,
}: ToolInventoryRowProps) {
  const [open, setOpen] = useState(false);
  // Lifted here (rather than left inside ToolOwnershipSelect) so flipping
  // Own/Rent updates the cost label and order-status wording in this same
  // row immediately, instead of waiting on the server round trip to revalidate.
  const [isRental, setIsRental] = useState(tool.is_rental);

  return (
    <>
      <tr className="border-b border-border align-middle">
        <td className="sticky left-0 z-10 bg-card p-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0">
              <ToolImageThumb imagePath={tool.image_path} icon={tool.icon} />
            </div>
            <div>
              <p className="font-medium">{tool.name}</p>
            </div>
          </div>
        </td>
        <td className="p-2">
          <div className="flex flex-wrap gap-1">
            {tool.kits.length > 0 ? (
              [...tool.kits]
                .sort((a, b) => a - b)
                .map((kit) => (
                  <span
                    key={kit}
                    className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                  >
                    Kit {kit}
                  </span>
                ))
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </div>
        </td>
        <td className="p-2">
          <ToolStorageLocationInput
            toolId={tool.id}
            initialLocation={tool.storage_location}
            stockMethod={tool.stock_method}
            locations={storageLocations}
          />
        </td>
        <td className="p-2">
          <ToolOwnershipSelect toolId={tool.id} isRental={isRental} onChange={setIsRental} />
        </td>
        <td className="p-2">
          <ToolQuantityInput toolId={tool.id} initialQuantity={tool.quantity} />
        </td>
        <td className="p-2">
          <ToolReorderThresholdInput toolId={tool.id} initialThreshold={tool.reorder_threshold} />
        </td>
        <td className="p-2">
          <ToolOrderStatus
            toolId={tool.id}
            quantity={tool.quantity}
            reorderThreshold={tool.reorder_threshold}
            onOrder={tool.on_order}
            isRental={isRental}
          />
        </td>
        <td className="p-2">
          <ToolCostInput toolId={tool.id} initialCost={tool.cost} isRental={isRental} />
        </td>
        <td className="p-2">
          <ResaleCell cost={tool.cost} override={tool.resale_value} isRental={isRental} />
        </td>
        <td className="p-2">
          <ToolBuyLink url={tool.purchase_url} />
        </td>
        <td className="p-2 text-right">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-primary"
            aria-label={open ? "Collapse details" : "Expand details"}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-b border-border bg-muted/30">
          <td colSpan={11} className="p-3">
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Photo</span>
                <ToolImageUpload toolId={tool.id} imagePath={tool.image_path} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Tracked as</span>
                <ToolCategorySelect toolId={tool.id} category={tool.category} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Purchase link</span>
                <ToolPurchaseLinkInput toolId={tool.id} initialUrl={tool.purchase_url} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Where in the shop</span>
                <ToolShopLocationInput toolId={tool.id} initialValue={tool.shop_location} />
              </div>
              {isRental && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">Why don&apos;t we own it?</span>
                    <ToolNotOwnedReasonInput toolId={tool.id} initialReason={tool.not_owned_reason} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">Cost to own it</span>
                    <ToolCostToOwnInput toolId={tool.id} initialCost={tool.cost_to_own} />
                  </div>
                </>
              )}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Kits</span>
                <ToolKitsInput toolId={tool.id} initialKits={tool.kits} availableKits={availableKits} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Applies to services</span>
                <ToolServiceToggles
                  toolId={tool.id}
                  serviceTypes={serviceTypes}
                  linkedServiceTypeIds={linkedServiceTypeIds}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Remove</span>
                <DeactivateToolButton id={tool.id} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

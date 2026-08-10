"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { ToolImageThumb } from "./tool-image-thumb";
import { ToolImageUpload } from "./tool-image-upload";
import { ToolKitsInput } from "./tool-kits-input";
import { ToolCostInput } from "./tool-cost-input";
import { ToolQuantityInput } from "./tool-quantity-input";
import { ToolOwnershipSelect } from "./tool-ownership-select";
import { ToolServiceToggles } from "./tool-service-toggles";
import { DeactivateToolButton } from "./deactivate-tool-button";
import type { Tool } from "@/types/domain";

interface ToolInventoryRowProps {
  tool: Tool;
  serviceTypes: { id: string; label: string }[];
  linkedServiceTypeIds: string[];
  availableKits: number[];
}

export function ToolInventoryRow({ tool, serviceTypes, linkedServiceTypeIds, availableKits }: ToolInventoryRowProps) {
  const [open, setOpen] = useState(false);

  const status =
    tool.quantity === 0
      ? { label: "Out of stock", className: "bg-destructive/10 text-destructive" }
      : tool.quantity != null
        ? { label: "In stock", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" }
        : { label: "Not tracked", className: "bg-muted text-muted-foreground" };

  return (
    <>
      <tr className="border-b border-border align-middle">
        <td className="p-2">
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
          <ToolOwnershipSelect toolId={tool.id} initialIsRental={tool.is_rental} />
        </td>
        <td className="p-2">
          <ToolQuantityInput toolId={tool.id} initialQuantity={tool.quantity} />
        </td>
        <td className="p-2">
          <ToolCostInput toolId={tool.id} initialCost={tool.cost} />
        </td>
        <td className="p-2">
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>
            {status.label}
          </span>
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
          <td colSpan={7} className="p-3">
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Photo</span>
                <ToolImageUpload toolId={tool.id} imagePath={tool.image_path} />
              </div>
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

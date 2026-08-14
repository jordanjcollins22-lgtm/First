"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { MaterialCostInput } from "./material-cost-input";
import { MaterialQuantityInput } from "./material-quantity-input";
import { MaterialReorderThresholdInput } from "./material-reorder-threshold-input";
import { MaterialPurchaseLinkInput } from "./material-purchase-link-input";
import { MaterialDescriptionInput } from "./material-description-input";
import { MaterialBuyLink } from "./material-buy-link";
import { MaterialStorageLocationInput } from "./material-storage-location-input";
import { MaterialShopLocationInput } from "./material-shop-location-input";
import { MaterialCanStoreSelect } from "./material-can-store-select";
import { MaterialStorageAlternativeInput } from "./material-storage-alternative-input";
import { MaterialStorageRequirementsInput } from "./material-storage-requirements-input";
import { MaterialStorageCostInput } from "./material-storage-cost-input";
import { MaterialImageUpload } from "./material-image-upload";
import { MaterialImageThumb } from "./material-image-thumb";
import { MaterialOrderStatus } from "./material-order-status";
import { DeactivateMaterialButton } from "./deactivate-material-button";
import { DeleteMaterialRuleButton } from "./delete-material-rule-button";
import { serviceTypeById } from "@/components/canvas/service-catalog";
import type { Material } from "@/types/domain";

interface MaterialRule {
  id: string;
  service_type_id: string;
  match_field: string | null;
  match_value: string | null;
}

interface MaterialInventoryRowProps {
  material: Material;
  rules: MaterialRule[];
}

export function MaterialInventoryRow({ material, rules }: MaterialInventoryRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className="border-b border-border align-middle">
        <td className="p-2">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 shrink-0">
              <MaterialImageThumb imagePath={material.image_path} />
            </div>
            <div>
              <p className="font-medium">{material.name}</p>
              <p className="text-xs text-muted-foreground">
                {material.coverage_per_unit_sqft
                  ? `${material.coverage_per_unit_sqft} sq ft / ${material.unit.replace(/s$/, "")}`
                  : material.unit}{" "}
                · {material.waste_factor_pct}% waste
              </p>
            </div>
          </div>
        </td>
        <td className="p-2">
          <MaterialStorageLocationInput materialId={material.id} initialLocation={material.storage_location} />
        </td>
        <td className="p-2">
          <MaterialQuantityInput materialId={material.id} initialQuantity={material.quantity_on_hand} />
        </td>
        <td className="p-2">
          <MaterialReorderThresholdInput materialId={material.id} initialThreshold={material.reorder_threshold} />
        </td>
        <td className="p-2">
          <MaterialOrderStatus
            materialId={material.id}
            quantityOnHand={material.quantity_on_hand}
            reorderThreshold={material.reorder_threshold}
            onOrder={material.on_order}
          />
        </td>
        <td className="p-2">
          <MaterialCostInput materialId={material.id} initialCost={material.cost_per_unit} />
        </td>
        <td className="p-2">
          <MaterialBuyLink url={material.purchase_url} />
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
          <td colSpan={8} className="p-3">
            <div className="flex flex-wrap items-start gap-6">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Photo</span>
                <MaterialImageUpload materialId={material.id} imagePath={material.image_path} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Purchase link</span>
                <MaterialPurchaseLinkInput materialId={material.id} initialUrl={material.purchase_url} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Where in the shop</span>
                <MaterialShopLocationInput materialId={material.id} initialValue={material.shop_location} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Description</span>
                <MaterialDescriptionInput materialId={material.id} initialDescription={material.description} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Can we store it?</span>
                <MaterialCanStoreSelect materialId={material.id} initialCanStore={material.can_store} />
              </div>
              {!material.can_store && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Where to go instead</span>
                  <MaterialStorageAlternativeInput
                    materialId={material.id}
                    initialValue={material.storage_alternative}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">What&apos;s needed to store it</span>
                <MaterialStorageRequirementsInput
                  materialId={material.id}
                  initialValue={material.storage_requirements}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Cost to store</span>
                <MaterialStorageCostInput materialId={material.id} initialCost={material.storage_cost} />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Applies to services</span>
                <div className="flex flex-wrap gap-1.5">
                  {rules.map((rule) => (
                    <span
                      key={rule.id}
                      className="flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {serviceTypeById(rule.service_type_id)?.label ?? rule.service_type_id}
                      {rule.match_field && ` · ${rule.match_field}=${rule.match_value}`}
                      <DeleteMaterialRuleButton id={rule.id} />
                    </span>
                  ))}
                  {rules.length === 0 && <span className="text-xs text-muted-foreground">No rules yet.</span>}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs text-muted-foreground">Remove</span>
                <DeactivateMaterialButton id={material.id} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

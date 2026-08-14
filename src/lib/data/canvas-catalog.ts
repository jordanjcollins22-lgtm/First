import { createClient } from "@/lib/supabase/server";
import { listTools } from "./tools";
import { listMaterials } from "./materials";
import { listServicePricing } from "./service-pricing";
import { listCustomFieldOptions, type CustomFieldOptions } from "./custom-field-options";
import { getCurrentOrganization } from "./organizations";
import type {
  MeasurementBasis,
  Material,
  ServiceMaterialRule,
  ServicePricing,
  ServiceToolLink,
  Tool,
} from "@/types/domain";

export interface CanvasCatalog {
  tools: Tool[];
  materials: Material[];
  serviceTools: ServiceToolLink[];
  serviceMaterialRules: ServiceMaterialRule[];
  servicePricing: ServicePricing[];
  customFieldOptions: CustomFieldOptions;
  /** The business's pricing unit and what a per-unit price multiplies by. */
  measurementUnit: string;
  measurementBasis: MeasurementBasis;
}

export async function getCanvasCatalog(): Promise<CanvasCatalog> {
  const supabase = await createClient();
  const [tools, materials, servicePricing, customFieldOptions, organization, serviceToolsRes, serviceMaterialsRes] =
    await Promise.all([
      listTools(),
      listMaterials(),
      listServicePricing(),
      listCustomFieldOptions(),
      getCurrentOrganization(),
      supabase.from("service_tools").select("*"),
      supabase.from("service_materials").select("*"),
    ]);

  if (serviceToolsRes.error) throw serviceToolsRes.error;
  if (serviceMaterialsRes.error) throw serviceMaterialsRes.error;

  return {
    tools,
    materials,
    servicePricing,
    customFieldOptions,
    measurementUnit: organization.measurement_unit || "sq ft",
    measurementBasis:
      organization.measurement_basis === "perimeter" || organization.measurement_basis === "flat"
        ? organization.measurement_basis
        : "area",
    serviceTools: (serviceToolsRes.data ?? []) as unknown as ServiceToolLink[],
    serviceMaterialRules: (serviceMaterialsRes.data ?? []) as unknown as ServiceMaterialRule[],
  };
}

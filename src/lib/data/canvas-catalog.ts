import { createClient } from "@/lib/supabase/server";
import { listTools } from "./tools";
import { listMaterials } from "./materials";
import { listServicePricing } from "./service-pricing";
import { listCustomFieldOptions, type CustomFieldOptions } from "./custom-field-options";
import type { Material, ServiceMaterialRule, ServicePricing, ServiceToolLink, Tool } from "@/types/domain";

export interface CanvasCatalog {
  tools: Tool[];
  materials: Material[];
  serviceTools: ServiceToolLink[];
  serviceMaterialRules: ServiceMaterialRule[];
  servicePricing: ServicePricing[];
  customFieldOptions: CustomFieldOptions;
}

export async function getCanvasCatalog(): Promise<CanvasCatalog> {
  const supabase = await createClient();
  const [tools, materials, servicePricing, customFieldOptions, serviceToolsRes, serviceMaterialsRes] =
    await Promise.all([
      listTools(),
      listMaterials(),
      listServicePricing(),
      listCustomFieldOptions(),
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
    serviceTools: (serviceToolsRes.data ?? []) as unknown as ServiceToolLink[],
    serviceMaterialRules: (serviceMaterialsRes.data ?? []) as unknown as ServiceMaterialRule[],
  };
}

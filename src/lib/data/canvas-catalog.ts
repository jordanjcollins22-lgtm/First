import { createClient } from "@/lib/supabase/server";
import { listTools } from "./tools";
import { listMaterials } from "./materials";
import type { Material, ServiceMaterialRule, ServiceToolLink, Tool } from "@/types/domain";

export interface CanvasCatalog {
  tools: Tool[];
  materials: Material[];
  serviceTools: ServiceToolLink[];
  serviceMaterialRules: ServiceMaterialRule[];
}

export async function getCanvasCatalog(): Promise<CanvasCatalog> {
  const supabase = await createClient();
  const [tools, materials, serviceToolsRes, serviceMaterialsRes] = await Promise.all([
    listTools(),
    listMaterials(),
    supabase.from("service_tools").select("*"),
    supabase.from("service_materials").select("*"),
  ]);

  if (serviceToolsRes.error) throw serviceToolsRes.error;
  if (serviceMaterialsRes.error) throw serviceMaterialsRes.error;

  return {
    tools,
    materials,
    serviceTools: (serviceToolsRes.data ?? []) as unknown as ServiceToolLink[],
    serviceMaterialRules: (serviceMaterialsRes.data ?? []) as unknown as ServiceMaterialRule[],
  };
}

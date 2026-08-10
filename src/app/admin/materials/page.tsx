import { listMaterials } from "@/lib/data/materials";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_TYPES, serviceTypeById } from "@/components/canvas/service-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CreateMaterialForm } from "@/components/material/create-material-form";
import { MaterialCostInput } from "@/components/material/material-cost-input";
import { DeactivateMaterialButton } from "@/components/material/deactivate-material-button";
import { AddMaterialRuleForm } from "@/components/material/add-material-rule-form";
import { DeleteMaterialRuleButton } from "@/components/material/delete-material-rule-button";

export default async function MaterialsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const supabase = await createClient();
  const [materials, rulesRes] = await Promise.all([
    listMaterials(),
    supabase.from("service_materials").select("*"),
  ]);

  const rulesByMaterial = new Map<string, typeof rulesRes.data>();
  for (const rule of rulesRes.data ?? []) {
    const arr = rulesByMaterial.get(rule.material_id) ?? [];
    arr.push(rule);
    rulesByMaterial.set(rule.material_id, arr);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Material List</h1>
      <p className="mb-6 text-muted-foreground">
        Coverage rates and costs used to turn a zone&apos;s real square footage into an
        order quantity on the canvas&apos;s Materials &amp; Rentals page.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a material</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateMaterialForm />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Auto-apply rules</CardTitle>
        </CardHeader>
        <CardContent>
          <AddMaterialRuleForm materials={materials} serviceTypes={SERVICE_TYPES} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {materials.map((material) => (
          <Card key={material.id}>
            <CardContent className="flex flex-col gap-3 pt-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-semibold">{material.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {material.coverage_per_unit_sqft
                      ? `${material.coverage_per_unit_sqft} sq ft / ${material.unit.replace(/s$/, "")}`
                      : material.unit}{" "}
                    · {material.waste_factor_pct}% waste
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <MaterialCostInput materialId={material.id} initialCost={material.cost_per_unit} />
                  <DeactivateMaterialButton id={material.id} />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(rulesByMaterial.get(material.id) ?? []).map((rule) => (
                  <span
                    key={rule.id}
                    className="flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs text-muted-foreground"
                  >
                    {serviceTypeById(rule.service_type_id)?.label ?? rule.service_type_id}
                    {rule.match_field && ` · ${rule.match_field}=${rule.match_value}`}
                    <DeleteMaterialRuleButton id={rule.id} />
                  </span>
                ))}
                {(rulesByMaterial.get(material.id) ?? []).length === 0 && (
                  <span className="text-xs text-muted-foreground">No rules yet.</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
        {materials.length === 0 && (
          <p className="text-sm text-muted-foreground">No materials yet — add one above.</p>
        )}
      </div>
    </div>
  );
}

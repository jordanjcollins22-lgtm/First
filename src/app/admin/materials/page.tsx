import { listMaterials } from "@/lib/data/materials";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_TYPES } from "@/components/canvas/service-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CreateMaterialForm } from "@/components/material/create-material-form";
import { AddMaterialRuleForm } from "@/components/material/add-material-rule-form";
import { MaterialInventoryRow } from "@/components/material/material-inventory-row";

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

  const toOrderCount = materials.filter(
    (m) => !m.on_order && m.quantity_on_hand != null && m.reorder_threshold != null && m.quantity_on_hand <= m.reorder_threshold
  ).length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Material Database</h1>
      <p className="mb-6 text-muted-foreground">
        Stock on hand, reorder thresholds, cost, and where to buy each material.
        Coverage rates also turn a zone&apos;s real square footage into an order
        quantity on the canvas&apos;s Materials &amp; Rentals page.
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
          <AddMaterialRuleForm
            materials={materials}
            serviceTypes={SERVICE_TYPES.map(({ id, label, fields }) => ({ id, label, fields }))}
          />
        </CardContent>
      </Card>

      <div className="mb-3 flex items-center gap-4 text-sm text-muted-foreground">
        <span>{materials.length} materials</span>
        {toOrderCount > 0 && (
          <span className="font-medium text-destructive">{toOrderCount} need ordering</span>
        )}
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-2 font-medium">Material</th>
                <th className="p-2 font-medium">Stored At</th>
                <th className="p-2 font-medium">On hand</th>
                <th className="p-2 font-medium">Reorder at</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 font-medium">Cost</th>
                <th className="p-2 font-medium">Buy</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {materials.map((material) => (
                <MaterialInventoryRow
                  key={material.id}
                  material={material}
                  rules={rulesByMaterial.get(material.id) ?? []}
                />
              ))}
            </tbody>
          </table>
        </div>
        {materials.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No materials yet — add one above.</p>
        )}
      </Card>
    </div>
  );
}

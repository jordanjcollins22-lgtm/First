import { redirect } from "next/navigation";

import { listTools } from "@/lib/data/tools";
import { listMaterials } from "@/lib/data/materials";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { checkTabAccess } from "@/lib/data/access";
import { SERVICE_TYPES } from "@/components/canvas/service-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CreateToolForm } from "@/components/tool/create-tool-form";
import { ToolInventoryRow } from "@/components/tool/tool-inventory-row";
import { CreateMaterialForm } from "@/components/material/create-material-form";
import { AddMaterialRuleForm } from "@/components/material/add-material-rule-form";
import { MaterialInventoryRow } from "@/components/material/material-inventory-row";
import { InventoryViewToggle } from "@/components/inventory/inventory-view-toggle";

export default async function InventoryPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const [{ allowed: toolsAllowed }, { allowed: materialsAllowed }] = await Promise.all([
    checkTabAccess("tools"),
    checkTabAccess("materials"),
  ]);
  if (!toolsAllowed && !materialsAllowed) redirect("/attractors");

  const supabase = await createClient();
  const [tools, materials, linksRes, rulesRes] = await Promise.all([
    listTools(),
    listMaterials(),
    supabase.from("service_tools").select("*"),
    supabase.from("service_materials").select("*"),
  ]);

  const linksByTool = new Map<string, string[]>();
  for (const link of linksRes.data ?? []) {
    const arr = linksByTool.get(link.tool_id) ?? [];
    arr.push(link.service_type_id);
    linksByTool.set(link.tool_id, arr);
  }

  const rulesByMaterial = new Map<string, typeof rulesRes.data>();
  for (const rule of rulesRes.data ?? []) {
    const arr = rulesByMaterial.get(rule.material_id) ?? [];
    arr.push(rule);
    rulesByMaterial.set(rule.material_id, arr);
  }

  const serviceTypeOptions = SERVICE_TYPES.map((t) => ({ id: t.id, label: t.label }));
  const toolsToOrderCount = tools.filter(
    (t) => !t.on_order && t.quantity != null && t.reorder_threshold != null && t.quantity <= t.reorder_threshold
  ).length;
  const availableKits = [...new Set(tools.flatMap((t) => t.kits))].sort((a, b) => a - b);

  const materialsToOrderCount = materials.filter(
    (m) =>
      !m.on_order &&
      m.quantity_on_hand != null &&
      m.reorder_threshold != null &&
      m.quantity_on_hand <= m.reorder_threshold
  ).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Inventory</h1>
      <p className="mb-6 text-muted-foreground">
        Tools and materials — stock on hand, where it&apos;s stored, cost, and reorder status.
      </p>

      <InventoryViewToggle
        showTools={toolsAllowed}
        showMaterials={materialsAllowed}
        toolsContent={
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Add a tool</CardTitle>
              </CardHeader>
              <CardContent>
                <CreateToolForm availableKits={availableKits} />
              </CardContent>
            </Card>

            <div className="mb-3 flex items-center gap-4 text-sm text-muted-foreground">
              <span>{tools.length} tools</span>
              {toolsToOrderCount > 0 && (
                <span className="font-medium text-destructive">{toolsToOrderCount} need buying or renting</span>
              )}
            </div>

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1160px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="p-2 font-medium">Tool</th>
                      <th className="p-2 font-medium">Kit(s)</th>
                      <th className="p-2 font-medium">Stored At</th>
                      <th className="p-2 font-medium">Own/Rent</th>
                      <th className="p-2 font-medium">Qty</th>
                      <th className="p-2 font-medium">Reorder at</th>
                      <th className="p-2 font-medium">Status</th>
                      <th className="p-2 font-medium">Cost</th>
                      <th className="p-2 font-medium">Buy</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {tools.map((tool) => (
                      <ToolInventoryRow
                        key={tool.id}
                        tool={tool}
                        serviceTypes={serviceTypeOptions}
                        linkedServiceTypeIds={linksByTool.get(tool.id) ?? []}
                        availableKits={availableKits}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {tools.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No tools yet — add one above.</p>
              )}
            </Card>
          </>
        }
        materialsContent={
          <>
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
              {materialsToOrderCount > 0 && (
                <span className="font-medium text-destructive">{materialsToOrderCount} need ordering</span>
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
          </>
        }
      />
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";

import { listTools } from "@/lib/data/tools";
import { listMaterials } from "@/lib/data/materials";
import { listServicePricing } from "@/lib/data/service-pricing";
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
  const [tools, materials, services, linksRes, rulesRes] = await Promise.all([
    listTools(),
    listMaterials(),
    listServicePricing(),
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

  const customActiveServices = services.filter((s) => s.status === "active" && !SERVICE_TYPES.some((t) => t.id === s.service_type_id));
  const serviceTypeOptions = [
    ...SERVICE_TYPES.map((t) => ({ id: t.id, label: t.label })),
    ...customActiveServices.map((s) => ({ id: s.service_type_id, label: s.name })),
  ];
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

  const isEmpty = tools.length === 0 && materials.length === 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="mb-1 text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">
            Tools and materials — stock on hand, where it&apos;s stored, cost, and reorder status.
          </p>
        </div>
        <Link
          href="/admin/inventory-setup"
          className="shrink-0 whitespace-nowrap rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Quick setup
        </Link>
      </div>

      {isEmpty && (
        <Card className="mb-6 border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
            <p className="text-sm">
              Starting fresh? Use quick setup to rapid-add your current tools and materials — anything new gets
              added automatically the first time you quote it.
            </p>
            <Link
              href="/admin/inventory-setup"
              className="shrink-0 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Set up your inventory →
            </Link>
          </CardContent>
        </Card>
      )}

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
                  serviceTypes={[
                    ...SERVICE_TYPES.map(({ id, label, fields }) => ({ id, label, fields })),
                    ...customActiveServices.map((s) => ({ id: s.service_type_id, label: s.name, fields: [] })),
                  ]}
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
                        serviceTypeOptions={serviceTypeOptions}
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

import { listTools } from "@/lib/data/tools";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_TYPES } from "@/components/canvas/service-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CreateToolForm } from "@/components/tool/create-tool-form";
import { ToolCostInput } from "@/components/tool/tool-cost-input";
import { ToolKitsInput } from "@/components/tool/tool-kits-input";
import { ToolImageUpload } from "@/components/tool/tool-image-upload";
import { ToolQuantityInput } from "@/components/tool/tool-quantity-input";
import { ToolServiceToggles } from "@/components/tool/tool-service-toggles";
import { DeactivateToolButton } from "@/components/tool/deactivate-tool-button";
import { ToolImageThumb } from "@/components/tool/tool-image-thumb";

export default async function ToolsPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const supabase = await createClient();
  const [tools, linksRes] = await Promise.all([
    listTools(),
    supabase.from("service_tools").select("*"),
  ]);

  const linksByTool = new Map<string, string[]>();
  for (const link of linksRes.data ?? []) {
    const arr = linksByTool.get(link.tool_id) ?? [];
    arr.push(link.service_type_id);
    linksByTool.set(link.tool_id, arr);
  }

  const serviceTypeOptions = SERVICE_TYPES.map((t) => ({ id: t.id, label: t.label }));

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Tool Database</h1>
      <p className="mb-6 text-muted-foreground">
        Your tools at a glance — image, name, and kit(s). Open a tool for cost, stock,
        and which services it applies to.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a tool</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateToolForm />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {tools.map((tool) => (
          <Card key={tool.id} className="overflow-hidden">
            <ToolImageThumb imagePath={tool.image_path} icon={tool.icon} />
            <CardContent className="flex flex-col gap-1.5 p-3">
              <p className="truncate font-semibold" title={tool.name}>
                {tool.name}
              </p>
              {tool.quantity === 0 && (
                <p className="text-xs font-medium text-destructive">Out of stock</p>
              )}
              <div className="flex flex-wrap gap-1">
                {tool.kits.length > 0 ? (
                  tool.kits.map((kit) => (
                    <span
                      key={kit}
                      className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {kit}
                    </span>
                  ))
                ) : (
                  <span className="text-[10px] text-muted-foreground">No kit yet</span>
                )}
              </div>

              <details className="mt-1 text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-primary">
                  Details
                </summary>
                <div className="mt-2 flex flex-col gap-2">
                  <ToolImageUpload toolId={tool.id} imagePath={tool.image_path} />
                  <ToolKitsInput toolId={tool.id} initialKits={tool.kits} />
                  <div className="flex items-center gap-2">
                    <ToolCostInput toolId={tool.id} initialCost={tool.cost} />
                    <ToolQuantityInput toolId={tool.id} initialQuantity={tool.quantity} />
                  </div>
                  {tool.is_rental && <p className="text-muted-foreground">Rental item</p>}
                  <ToolServiceToggles
                    toolId={tool.id}
                    serviceTypes={serviceTypeOptions}
                    linkedServiceTypeIds={linksByTool.get(tool.id) ?? []}
                  />
                  <DeactivateToolButton id={tool.id} />
                </div>
              </details>
            </CardContent>
          </Card>
        ))}
        {tools.length === 0 && (
          <p className="col-span-full text-sm text-muted-foreground">No tools yet — add one above.</p>
        )}
      </div>
    </div>
  );
}

import { listTools } from "@/lib/data/tools";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { SERVICE_TYPES } from "@/components/canvas/service-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { CreateToolForm } from "@/components/tool/create-tool-form";
import { ToolCostInput } from "@/components/tool/tool-cost-input";
import { ToolKitInput } from "@/components/tool/tool-kit-input";
import { ToolImageUpload } from "@/components/tool/tool-image-upload";
import { ToolQuantityInput } from "@/components/tool/tool-quantity-input";
import { ToolServiceToggles } from "@/components/tool/tool-service-toggles";
import { DeactivateToolButton } from "@/components/tool/deactivate-tool-button";
import type { Tool } from "@/types/domain";

const UNGROUPED_KIT = "Ungrouped";

function groupToolsByKit(tools: Tool[]): Map<string, Tool[]> {
  const groups = new Map<string, Tool[]>();
  for (const tool of tools) {
    const key = tool.kit?.trim() || UNGROUPED_KIT;
    const arr = groups.get(key) ?? [];
    arr.push(tool);
    groups.set(key, arr);
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === UNGROUPED_KIT) return 1;
    if (b === UNGROUPED_KIT) return -1;
    return a.localeCompare(b);
  });
  const sorted = new Map<string, Tool[]>();
  for (const key of sortedKeys) sorted.set(key, groups.get(key)!);
  return sorted;
}

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
  const groups = groupToolsByKit(tools);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Tools</h1>
      <p className="mb-6 text-muted-foreground">
        Your tool inventory: costs, stock on hand, and photos. Group tools into kits
        for organization, and toggle which services a tool applies to — the canvas
        picks tools for a zone automatically from these, no manual selection needed
        there.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add a tool</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateToolForm />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-8">
        {[...groups.entries()].map(([kit, kitTools]) => (
          <div key={kit} className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {kit} <span className="font-normal">({kitTools.length})</span>
            </h2>
            {kitTools.map((tool) => (
              <Card key={tool.id}>
                <CardContent className="flex flex-col gap-3 pt-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <ToolImageUpload toolId={tool.id} imagePath={tool.image_path} />
                      <div className="flex items-center gap-2">
                        <span className="text-xl" aria-hidden>
                          {tool.icon}
                        </span>
                        <div>
                          <p className="font-semibold">{tool.name}</p>
                          {tool.is_rental && (
                            <p className="text-xs text-muted-foreground">Rental item</p>
                          )}
                          {tool.quantity === 0 && (
                            <p className="text-xs font-medium text-destructive">Out of stock</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <ToolQuantityInput toolId={tool.id} initialQuantity={tool.quantity} />
                      <ToolKitInput toolId={tool.id} initialKit={tool.kit} />
                      <ToolCostInput toolId={tool.id} initialCost={tool.cost} />
                      <DeactivateToolButton id={tool.id} />
                    </div>
                  </div>
                  <ToolServiceToggles
                    toolId={tool.id}
                    serviceTypes={serviceTypeOptions}
                    linkedServiceTypeIds={linksByTool.get(tool.id) ?? []}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        ))}
        {tools.length === 0 && (
          <p className="text-sm text-muted-foreground">No tools yet — add one above.</p>
        )}
      </div>
    </div>
  );
}

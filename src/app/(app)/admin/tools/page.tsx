import { redirect } from "next/navigation";
import Link from "next/link";

import { listTools } from "@/lib/data/tools";
import { listMaterials, listMarketingMaterials } from "@/lib/data/materials";
import { listServicePricing } from "@/lib/data/service-pricing";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { checkTabAccess } from "@/lib/data/access";
import { SERVICE_TYPES } from "@/components/canvas/service-catalog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SetupRequiredNotice } from "@/components/setup-required-notice";
import { InventoryAddForm } from "@/components/inventory/inventory-add-form";
import { ToolInventoryRow } from "@/components/tool/tool-inventory-row";
import { MaterialInventoryRow } from "@/components/material/material-inventory-row";
import { InventoryViewToggle } from "@/components/inventory/inventory-view-toggle";
import { PrintMenu } from "@/components/marketing/print-menu";
import { listBusinessLocations } from "@/lib/data/locations";

export default async function InventoryPage() {
  if (!isSupabaseConfigured) return <SetupRequiredNotice />;

  const [{ allowed: toolsAllowed }, { allowed: materialsAllowed }] = await Promise.all([
    checkTabAccess("tools"),
    checkTabAccess("materials"),
  ]);
  if (!toolsAllowed && !materialsAllowed) redirect("/my-day");

  const supabase = await createClient();
  const [tools, materials, marketing, services, linksRes, businessLocations] = await Promise.all([
    listTools(),
    listMaterials(),
    // Marketing stock lives in the same table under its own category, so
    // moving an item between the two lists is a one-field change.
    listMarketingMaterials().catch(() => []),
    listServicePricing(),
    supabase.from("service_tools").select("*"),
    // Same places as the Project Data map — one list, not two.
    listBusinessLocations().catch(() => []),
  ]);

  const linksByTool = new Map<string, string[]>();
  for (const link of linksRes.data ?? []) {
    const arr = linksByTool.get(link.tool_id) ?? [];
    arr.push(link.service_type_id);
    linksByTool.set(link.tool_id, arr);
  }

  const customActiveServices = services.filter((s) => s.status === "active" && !SERVICE_TYPES.some((t) => t.id === s.service_type_id));
  const serviceTypeOptions = [
    ...SERVICE_TYPES.map((t) => ({ id: t.id, label: t.label })),
    ...customActiveServices.map((s) => ({ id: s.service_type_id, label: s.name })),
  ];
  const needsOrdering = (items: typeof tools) =>
    items.filter(
      (t) => !t.on_order && t.quantity != null && t.reorder_threshold != null && t.quantity <= t.reorder_threshold
    ).length;
  const availableKits = [...new Set(tools.flatMap((t) => t.kits))].sort((a, b) => a - b);
  // Gear (PPE, tarps, water) lives in the same table as tools under a
  // category, so moving an item between the two is a one-field change.
  const equipment = tools.filter((t) => t.category !== "gear");
  const gear = tools.filter((t) => t.category === "gear");
  const storageLocations = businessLocations.map((location) => location.name);

  const needsOrderingCount = (items: typeof materials) =>
    items.filter(
      (m) =>
        !m.on_order &&
        m.quantity_on_hand != null &&
        m.reorder_threshold != null &&
        m.quantity_on_hand <= m.reorder_threshold
    ).length;

  const materialsToOrderCount = materials.filter(
    (m) =>
      !m.on_order &&
      m.quantity_on_hand != null &&
      m.reorder_threshold != null &&
      m.quantity_on_hand <= m.reorder_threshold
  ).length;

  const isEmpty = tools.length === 0 && materials.length === 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="mb-1 text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">
            Tools, crew gear, and materials — stock on hand, where it&apos;s stored, cost, and reorder status.
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <PrintMenu />
          <Link
            href="/admin/inventory-setup"
            className="whitespace-nowrap rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            Quick setup
          </Link>
        </div>
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
                <InventoryAddForm
                  group="tools"
                  availableKits={availableKits}
                  storageLocations={storageLocations}
                />
              </CardContent>
            </Card>

            <div className="mb-3 flex items-center gap-4 text-sm text-muted-foreground">
              <span>{equipment.length} tools</span>
              {needsOrdering(equipment) > 0 && (
                <span className="font-medium text-destructive">{needsOrdering(equipment)} need buying or renting</span>
              )}
            </div>

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1160px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="sticky left-0 z-10 bg-card p-2 font-medium">Tool</th>
                      <th className="p-2 font-medium">Kit(s)</th>
                      <th className="p-2 font-medium">Stored At</th>
                      <th className="p-2 font-medium">Own/Rent</th>
                      <th className="p-2 font-medium">Qty</th>
                      <th className="p-2 font-medium">Reorder at</th>
                      <th className="p-2 font-medium">Status</th>
                      <th className="p-2 font-medium">Cost (/day if rented)</th>
                      <th className="p-2 font-medium">Resale</th>
                      <th className="p-2 font-medium">Buy</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {equipment.map((tool) => (
                      <ToolInventoryRow
                        key={tool.id}
                        tool={tool}
                        serviceTypes={serviceTypeOptions}
                        linkedServiceTypeIds={linksByTool.get(tool.id) ?? []}
                        availableKits={availableKits}
                        storageLocations={storageLocations}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {equipment.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No tools yet — add one above.</p>
              )}
            </Card>
          </>
        }
        gearContent={
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Add crew gear</CardTitle>
              </CardHeader>
              <CardContent>
                <InventoryAddForm
                  group="gear"
                  availableKits={availableKits}
                  storageLocations={storageLocations}
                />
              </CardContent>
            </Card>

            <div className="mb-3 flex items-center gap-4 text-sm text-muted-foreground">
              <span>{gear.length} gear items</span>
              {needsOrdering(gear) > 0 && (
                <span className="font-medium text-destructive">{needsOrdering(gear)} need restocking</span>
              )}
            </div>

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1160px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="sticky left-0 z-10 bg-card p-2 font-medium">Gear</th>
                      <th className="p-2 font-medium">Kit(s)</th>
                      <th className="p-2 font-medium">Stored At</th>
                      <th className="p-2 font-medium">Own/Rent</th>
                      <th className="p-2 font-medium">Qty</th>
                      <th className="p-2 font-medium">Reorder at</th>
                      <th className="p-2 font-medium">Status</th>
                      <th className="p-2 font-medium">Cost (/day if rented)</th>
                      <th className="p-2 font-medium">Resale</th>
                      <th className="p-2 font-medium">Buy</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {gear.map((tool) => (
                      <ToolInventoryRow
                        key={tool.id}
                        tool={tool}
                        serviceTypes={serviceTypeOptions}
                        linkedServiceTypeIds={linksByTool.get(tool.id) ?? []}
                        availableKits={availableKits}
                        storageLocations={storageLocations}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {gear.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  No crew gear yet — add gloves, masks, tarps, plywood, water, electrolytes above. Already entered
                  something as a tool? Expand its row on the Tools tab and switch &ldquo;Tracked as&rdquo; to Crew gear.
                </p>
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
                <InventoryAddForm
                  group="materials"
                  availableKits={availableKits}
                  storageLocations={storageLocations}
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
                      <th className="sticky left-0 z-10 bg-card p-2 font-medium">Material</th>
                      <th className="p-2 font-medium">Stored At</th>
                      <th className="p-2 font-medium">On hand</th>
                      <th className="p-2 font-medium">Reorder at</th>
                      <th className="p-2 font-medium">Status</th>
                      <th className="p-2 font-medium">Cost</th>
                      <th className="p-2 font-medium">Resale</th>
                      <th className="p-2 font-medium">Buy</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {materials.map((material) => (
                      <MaterialInventoryRow key={material.id} material={material} storageLocations={storageLocations} />
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
        marketingContent={
          <>
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>Add a marketing resource</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="mb-3 text-sm text-muted-foreground">
                  Door hangers, flyers, yard signs, business cards. Same stock levels and reorder alerts as
                  job materials — kept on its own list so nobody is offered a business card while pricing a
                  patio. Link these to ideas on the{" "}
                  <Link href="/knowledge-graph" className="underline">
                    Knowledge Graph
                  </Link>{" "}
                  and the cost of a campaign works itself out.
                </p>
                <InventoryAddForm
                  group="marketing"
                  availableKits={availableKits}
                  storageLocations={storageLocations}
                />
              </CardContent>
            </Card>

            <div className="mb-3 flex items-center gap-4 text-sm text-muted-foreground">
              <span>{marketing.length} marketing resources</span>
              {needsOrderingCount(marketing) > 0 && (
                <span className="font-medium text-destructive">
                  {needsOrderingCount(marketing)} need ordering
                </span>
              )}
            </div>

            <Card>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="sticky left-0 z-10 bg-card p-2 font-medium">Resource</th>
                      <th className="p-2 font-medium">Stored At</th>
                      <th className="p-2 font-medium">On hand</th>
                      <th className="p-2 font-medium">Reorder at</th>
                      <th className="p-2 font-medium">Status</th>
                      <th className="p-2 font-medium">Cost</th>
                      <th className="p-2 font-medium">Resale</th>
                      <th className="p-2 font-medium">Buy</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {marketing.map((material) => (
                      <MaterialInventoryRow
                        key={material.id}
                        material={material}
                        storageLocations={storageLocations}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {marketing.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">
                  Nothing here yet — add the first door hanger or flyer above.
                </p>
              )}
            </Card>
          </>
        }
      />
    </div>
  );
}

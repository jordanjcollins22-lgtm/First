"use client";

import type { ReactNode } from "react";

import { PageTabs } from "@/components/ui/page-tabs";

/**
 * Inventory's four lists.
 *
 * A thin naming of the shared tab strip rather than its own copy of one:
 * two tab components in a codebase is two behaviours to keep in step, and
 * they never stay in step.
 */
export function InventoryViewToggle({
  showTools,
  showMaterials,
  toolsContent,
  gearContent,
  materialsContent,
  marketingContent,
}: {
  showTools: boolean;
  showMaterials: boolean;
  toolsContent: ReactNode;
  /** Crew gear shares the tools permission — it's the same table. */
  gearContent: ReactNode;
  materialsContent: ReactNode;
  /** Door hangers, flyers, yard signs — same table and same reorder alerts
   * as job materials, kept on their own list so an estimator pricing a patio
   * is never offered a business card. */
  marketingContent: ReactNode;
}) {
  return (
    <PageTabs
      tabs={[
        { key: "tools", label: "Tools", content: toolsContent, visible: showTools },
        { key: "gear", label: "Crew Gear", content: gearContent, visible: showTools },
        { key: "materials", label: "Materials", content: materialsContent, visible: showMaterials },
        { key: "marketing", label: "Marketing", content: marketingContent, visible: showMaterials },
      ]}
    />
  );
}

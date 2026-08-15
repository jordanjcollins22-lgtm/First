"use client";

import { useState, type ReactNode } from "react";

type View = "tools" | "gear" | "materials";

export function InventoryViewToggle({
  showTools,
  showMaterials,
  toolsContent,
  gearContent,
  materialsContent,
}: {
  showTools: boolean;
  showMaterials: boolean;
  toolsContent: ReactNode;
  /** Crew gear shares the tools permission — it's the same table. */
  gearContent: ReactNode;
  materialsContent: ReactNode;
}) {
  const [view, setView] = useState<View>(showTools ? "tools" : "materials");

  const tabs: { key: View; label: string; visible: boolean }[] = [
    { key: "tools", label: "Tools", visible: showTools },
    { key: "gear", label: "Crew Gear", visible: showTools },
    { key: "materials", label: "Materials", visible: showMaterials },
  ];
  const visibleTabs = tabs.filter((tab) => tab.visible);

  return (
    <div>
      {visibleTabs.length > 1 && (
        <div className="mb-6 inline-flex rounded-lg border border-border p-1">
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setView(tab.key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                view === tab.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {showTools && <div className={view === "tools" ? "" : "hidden"}>{toolsContent}</div>}
      {showTools && <div className={view === "gear" ? "" : "hidden"}>{gearContent}</div>}
      {showMaterials && <div className={view === "materials" ? "" : "hidden"}>{materialsContent}</div>}
    </div>
  );
}

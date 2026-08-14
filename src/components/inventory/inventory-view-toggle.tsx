"use client";

import { useState, type ReactNode } from "react";

export function InventoryViewToggle({
  showTools,
  showMaterials,
  toolsContent,
  materialsContent,
}: {
  showTools: boolean;
  showMaterials: boolean;
  toolsContent: ReactNode;
  materialsContent: ReactNode;
}) {
  const [view, setView] = useState<"tools" | "materials">(showTools ? "tools" : "materials");

  return (
    <div>
      {showTools && showMaterials && (
        <div className="mb-6 inline-flex rounded-lg border border-border p-1">
          <button
            type="button"
            onClick={() => setView("tools")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              view === "tools" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"
            }`}
          >
            Tools
          </button>
          <button
            type="button"
            onClick={() => setView("materials")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              view === "materials" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"
            }`}
          >
            Materials
          </button>
        </div>
      )}
      {showTools && <div className={view === "tools" ? "" : "hidden"}>{toolsContent}</div>}
      {showMaterials && <div className={view === "materials" ? "" : "hidden"}>{materialsContent}</div>}
    </div>
  );
}

"use client";

import { useState, type ReactNode } from "react";

export function TeamServicesToggle({
  showTeam,
  showServices,
  teamContent,
  servicesContent,
}: {
  showTeam: boolean;
  showServices: boolean;
  teamContent: ReactNode;
  servicesContent: ReactNode;
}) {
  const [view, setView] = useState<"team" | "services">(showTeam ? "team" : "services");

  return (
    <div>
      {showTeam && showServices && (
        <div className="mb-6 inline-flex rounded-lg border border-border p-1">
          <button
            type="button"
            onClick={() => setView("team")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              view === "team" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"
            }`}
          >
            Team
          </button>
          <button
            type="button"
            onClick={() => setView("services")}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              view === "services" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"
            }`}
          >
            Services
          </button>
        </div>
      )}
      {showTeam && <div className={view === "team" ? "" : "hidden"}>{teamContent}</div>}
      {showServices && <div className={view === "services" ? "" : "hidden"}>{servicesContent}</div>}
    </div>
  );
}

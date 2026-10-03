"use client";

import { useTransition } from "react";

import { cn } from "@/lib/utils";
import { setServiceToolLink } from "@/lib/actions/tool-actions";

interface ToolServiceTogglesProps {
  toolId: string;
  serviceTypes: { id: string; label: string }[];
  linkedServiceTypeIds: string[];
}

export function ToolServiceToggles({ toolId, serviceTypes, linkedServiceTypeIds }: ToolServiceTogglesProps) {
  const [isPending, startTransition] = useTransition();

  function toggle(serviceTypeId: string, enabled: boolean) {
    startTransition(() => setServiceToolLink(serviceTypeId, toolId, enabled));
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {serviceTypes.map((type) => {
        const active = linkedServiceTypeIds.includes(type.id);
        return (
          <button
            key={type.id}
            type="button"
            disabled={isPending}
            onClick={() => toggle(type.id, !active)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            )}
          >
            {type.label}
          </button>
        );
      })}
    </div>
  );
}

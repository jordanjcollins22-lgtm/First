"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deactivateTool } from "@/lib/actions/tool-actions";

export function DeactivateToolButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      disabled={isPending}
      onClick={() => startTransition(() => deactivateTool(id))}
      title="Deactivate"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

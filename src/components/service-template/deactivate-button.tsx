"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deactivateServiceTemplate } from "@/lib/actions/service-template-actions";

export function DeactivateButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      disabled={isPending}
      onClick={() => startTransition(() => deactivateServiceTemplate(id))}
      title="Deactivate"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

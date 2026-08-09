"use client";

import { useTransition } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteServiceMaterialRule } from "@/lib/actions/material-actions";

export function DeleteMaterialRuleButton({ id }: { id: string }) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="h-6 w-6"
      disabled={isPending}
      onClick={() => startTransition(() => deleteServiceMaterialRule(id))}
    >
      <X className="h-3 w-3" />
    </Button>
  );
}

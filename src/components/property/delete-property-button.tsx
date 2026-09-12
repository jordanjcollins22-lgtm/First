"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteProperty } from "@/lib/actions/property-actions";

export function DeletePropertyButton({ id, address }: { id: string; address: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm(`Delete "${address}"? This removes the property and all its jobs — this can't be undone.`)) {
      return;
    }
    startTransition(() => deleteProperty(id));
  }

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      disabled={isPending}
      onClick={handleClick}
      title="Delete property"
      className="text-muted-foreground hover:text-destructive"
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

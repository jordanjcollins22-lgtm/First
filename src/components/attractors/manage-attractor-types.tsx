"use client";

import { useRef, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  addAttractorType,
  addAttractorVariant,
  deleteAttractorType,
  deleteAttractorVariant,
} from "@/lib/actions/attractor-actions";
import type { AttractorType, AttractorVariant } from "@/types/domain";

export function ManageAttractorTypes({ types, variants }: { types: AttractorType[]; variants: AttractorVariant[] }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const newTypeRef = useRef<HTMLInputElement>(null);
  const newVariantRefs = useRef<Record<string, HTMLInputElement | null>>({});

  function run(action: () => Promise<void>) {
    setError(null);
    startTransition(async () => {
      try {
        await action();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {types.map((type) => (
        <div key={type.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{type.label}</span>
            {!type.is_system && (
              <button
                type="button"
                onClick={() => run(() => deleteAttractorType(type.id))}
                disabled={isPending}
                aria-label={`Remove ${type.label} type`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {variants
              .filter((v) => v.type_id === type.id)
              .map((v) => (
                <span
                  key={v.id}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-xs"
                >
                  {v.name}
                  <button
                    type="button"
                    onClick={() => run(() => deleteAttractorVariant(v.id))}
                    disabled={isPending}
                    aria-label={`Remove ${v.name}`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            <Input
              ref={(el) => {
                newVariantRefs.current[type.id] = el;
              }}
              placeholder="Add variant"
              disabled={isPending}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                const input = newVariantRefs.current[type.id];
                const name = input?.value.trim();
                if (!name) return;
                run(() => addAttractorVariant(type.id, name));
                if (input) input.value = "";
              }}
              className="h-7 w-32 text-xs"
            />
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 border-t border-border pt-3">
        <Input ref={newTypeRef} placeholder="New attractor type name" disabled={isPending} className="h-9 w-56 text-sm" />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isPending}
          onClick={() => {
            const name = newTypeRef.current?.value.trim();
            if (!name) return;
            run(() => addAttractorType(name));
            if (newTypeRef.current) newTypeRef.current.value = "";
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add type
        </Button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

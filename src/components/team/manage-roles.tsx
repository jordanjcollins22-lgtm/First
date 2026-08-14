"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Pencil, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addRole, deleteRole, renameRole } from "@/lib/actions/team-actions";
import type { CustomRole } from "@/types/domain";

export function ManageRoles({ roles }: { roles: CustomRole[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = inputRef.current?.value.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      try {
        await addRole(name);
        if (inputRef.current) inputRef.current.value = "";
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function handleDelete(name: string) {
    setError(null);
    startTransition(async () => {
      try {
        await deleteRole(name);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  function startEditing(name: string) {
    setError(null);
    setEditing(name);
    setDraftName(name);
  }

  function handleRename(currentName: string) {
    setError(null);
    startTransition(async () => {
      try {
        await renameRole(currentName, draftName);
        setEditing(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {roles.map((role) =>
          editing === role.name ? (
            <span key={role.name} className="flex items-center gap-1">
              <Input
                value={draftName}
                autoFocus
                disabled={isPending}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleRename(role.name);
                  }
                  if (e.key === "Escape") setEditing(null);
                }}
                className="h-8 w-36 text-xs"
              />
              <button
                type="button"
                onClick={() => handleRename(role.name)}
                disabled={isPending}
                aria-label="Save role name"
                className="text-muted-foreground hover:text-primary"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={isPending}
                aria-label="Cancel rename"
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ) : (
            <span
              key={role.name}
              className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs capitalize"
            >
              {role.name}
              {!role.is_system && (
                <>
                  <button
                    type="button"
                    onClick={() => startEditing(role.name)}
                    disabled={isPending}
                    aria-label={`Rename ${role.name} role`}
                    className="text-muted-foreground hover:text-primary"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(role.name)}
                    disabled={isPending}
                    aria-label={`Remove ${role.name} role`}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </>
              )}
            </span>
          )
        )}
      </div>
      <form onSubmit={handleAdd} className="flex gap-2">
        <Input ref={inputRef} placeholder="New role name" disabled={isPending} className="h-9 w-48 text-sm" />
        <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
          <Plus className="h-3.5 w-3.5" />
          Add role
        </Button>
      </form>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

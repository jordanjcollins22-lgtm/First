"use client";

import { useTransition } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateProfileRole } from "@/lib/actions/team-actions";
import type { Role } from "@/types/domain";

export function RoleSelect({ profileId, initialRole, disabled }: { profileId: string; initialRole: Role; disabled?: boolean }) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string) {
    startTransition(() => updateProfileRole(profileId, value as Role));
  }

  return (
    <Select defaultValue={initialRole} onValueChange={handleChange} disabled={disabled || isPending}>
      <SelectTrigger className="h-9 w-28 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="admin">Admin</SelectItem>
        <SelectItem value="crew">Crew</SelectItem>
      </SelectContent>
    </Select>
  );
}
